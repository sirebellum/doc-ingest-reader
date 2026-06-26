use contracts::error::AppError;
use crate::tools::{AgentDatabases, AgentTool, QueryAgentDB, CreateNode, LinkNodes, AskHuman, ParsingComplete, CreateTag};
use dbs::manager::migrate_agent_to_content;

fn heuristic_repair_json(input: &str) -> String {
    use regex::Regex;

    let mut repaired = input.to_string();

    if let Ok(re) = Regex::new(r",\s*([\]}])") {
        repaired = re.replace_all(&repaired, "$1").to_string();
    }
    
    if let Ok(re) = Regex::new(r"([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:") {
        repaired = re.replace_all(&repaired, "${1}\"${2}\":").to_string();
    }

    let mut in_string = false;
    let mut escape = false;
    let mut stack = Vec::new();

    let trimmed = repaired.trim();
    
    for c in trimmed.chars() {
        if escape {
            escape = false;
            continue;
        }
        
        match c {
            '\\' => {
                if in_string {
                    escape = true;
                }
            }
            '"' => {
                in_string = !in_string;
            }
            '{' => {
                if !in_string {
                    stack.push('}');
                }
            }
            '[' => {
                if !in_string {
                    stack.push(']');
                }
            }
            '}' | ']' => {
                if !in_string {
                    if let Some(expected) = stack.last() {
                        if *expected == c {
                            stack.pop();
                        }
                    }
                }
            }
            _ => {}
        }
    }
    
    let mut final_repaired = trimmed.to_string();
    if in_string {
        final_repaired.push('"');
    }
    
    while let Some(closing_char) = stack.pop() {
        final_repaired.push(closing_char);
    }
    
    final_repaired
}

#[derive(Debug, PartialEq, Eq)]
pub enum AgentStatus {
    Running,
    WaitingForHuman(String),
    Completed,
    Error(String),
}

pub struct AgentState {
    pub databases: AgentDatabases,
    pub tools: Vec<Box<dyn AgentTool>>,
    pub status: AgentStatus,
    pub failed_tool_calls: u8,
    pub inference_override: Option<fn(&str) -> Result<String, AppError>>,
}

impl AgentState {
    pub fn new(dbs: AgentDatabases) -> Result<Self, AppError> {
        let tools: Vec<Box<dyn AgentTool>> = vec![
            Box::new(QueryAgentDB),
            Box::new(CreateNode),
            Box::new(LinkNodes),
            Box::new(AskHuman),
            Box::new(ParsingComplete),
            Box::new(crate::tools::QueryVectorDB),
            Box::new(crate::tools::ReadContentDB),
            Box::new(CreateTag),
        ];
        
        let id = uuid::Uuid::new_v4().to_string();
        dbs.agent_db.execute(
            "INSERT INTO conversation_history (id, session_id, role, content) VALUES (?1, ?2, 'system', ?3)",
            rusqlite::params![id, "session_1", crate::prompt::AGENT_SYSTEM_PROMPT]
        ).map_err(|e| AppError::DatabaseError(e.to_string()))?;
        
        Ok(Self {
            databases: dbs,
            tools,
            status: AgentStatus::Running,
            failed_tool_calls: 0,
            inference_override: None,
        })
    }

    fn append_history(&self, role: &str, content: &str) -> Result<(), AppError> {
        let id = uuid::Uuid::new_v4().to_string();
        self.databases.agent_db.execute(
            "INSERT INTO conversation_history (id, session_id, role, content) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![id, "session_1", role, content]
        ).map_err(|e| AppError::DatabaseError(e.to_string()))?;
        Ok(())
    }

    fn log_malformed_and_prompt(&mut self, raw_content: &str, error_msg: &str, prompt_msg: &str) -> Result<(), AppError> {
        let id = uuid::Uuid::new_v4().to_string();
        self.databases.agent_db.execute(
            "INSERT INTO malformed_blocks (id, document_id, raw_content, error_message) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                id,
                self.databases.document_id,
                raw_content,
                error_msg
            ]
        ).map_err(|e| AppError::DatabaseError(e.to_string()))?;
        self.append_history("tool", prompt_msg)?;
        self.failed_tool_calls += 1;
        Ok(())
    }

    pub fn step(&mut self) -> Result<AgentStatus, AppError> {
        if self.status != AgentStatus::Running {
            return Ok(
                match &self.status {
                    AgentStatus::Running => AgentStatus::Running,
                    AgentStatus::WaitingForHuman(reason) => AgentStatus::WaitingForHuman(reason.clone()),
                    AgentStatus::Completed => AgentStatus::Completed,
                    AgentStatus::Error(e) => AgentStatus::Error(e.clone()),
                }
            );
        }

        let mut history = String::new();
        if let Ok(mut stmt) = self.databases.agent_db.prepare("SELECT role, content FROM conversation_history WHERE session_id = 'session_1' ORDER BY created_at ASC") {
            if let Ok(mut rows) = stmt.query([]) {
                while let Ok(Some(row)) = rows.next() {
                    let role: String = row.get(0).unwrap_or_default();
                    let content: String = row.get(1).unwrap_or_default();
                    history.push_str(&format!("{}: {}\n\n", role.to_uppercase(), content));
                }
            }
        }

        let tools_desc = self.tools.iter()
            .map(|t| format!("- {}: {}", t.name(), t.description()))
            .collect::<Vec<_>>()
            .join("\n");

        let prompt = format!(
            "{}\n\nAVAILABLE TOOLS:\n{}\n\nINSTRUCTIONS:\nOutput your next action as a JSON object. Example: {{\"tool\": \"CreateNode\", \"args\": {{\"type\": \"section\", \"id\": \"sec_1\", \"title\": \"Chapter 1\", \"depth_level\": 1}}}}\n\nASSISTANT:\n",
            history, tools_desc
        );

        let llm_result = if let Some(func) = self.inference_override {
            func(&prompt)
        } else {
            inference::run_local_inference(&prompt)
        };

        let llm_output = match llm_result {
            Ok(out) => out,
            Err(e) => format!("{{\"tool\": \"AskHuman\", \"args\": {{\"question\": \"System Error during inference: {}\"}}}}", e),
        };

        println!("LLM_OUTPUT: {}", llm_output);

        self.append_history("assistant", &llm_output)?;

        let json_start = llm_output.find('{');
        let json_end = llm_output.rfind('}');

        if let Some(start) = json_start {
            let end_idx = if let Some(end) = json_end {
                if end > start { end } else { llm_output.len() - 1 }
            } else {
                llm_output.len() - 1
            };
            
            let mut json_slice = llm_output[start..=end_idx].to_string();
            let mut parsed_result = serde_json::from_str::<serde_json::Value>(&json_slice);
            
            if parsed_result.is_err() {
                let remainder = &llm_output[start..];
                json_slice = heuristic_repair_json(remainder);
                parsed_result = serde_json::from_str::<serde_json::Value>(&json_slice);
            }
                
                match parsed_result {
                    Ok(parsed) => {
                        let tool_name = parsed.get("tool").and_then(|v| v.as_str()).unwrap_or("");
                        let args = parsed.get("args").unwrap_or(&serde_json::Value::Null);
                        let args_str = args.to_string();

                        if let Some(tool) = self.tools.iter().find(|t| t.name().eq_ignore_ascii_case(tool_name) || (tool_name.eq_ignore_ascii_case("parseComplete") && t.name() == "ParsingComplete") || (tool_name.eq_ignore_ascii_case("read_content_db") && t.name() == "ReadContentDB")) {
                            match tool.execute(&args_str, &self.databases) {
                                Ok(output) => {
                                    self.append_history("tool", &output)?;
                                    self.failed_tool_calls = 0; // Reset
                                    
                                    if tool_name.eq_ignore_ascii_case("ParsingComplete") || tool_name.eq_ignore_ascii_case("parseComplete") {
                                        if let Err(e) = migrate_agent_to_content(
                                            &self.databases.agent_db_path,
                                            &self.databases.content_db_path,
                                            &self.databases.document_id
                                        ) {
                                            self.status = AgentStatus::Error(format!("Migration failed: {}", e));
                                        } else {
                                            self.status = AgentStatus::Completed;
                                        }
                                    } else if tool_name.eq_ignore_ascii_case("AskHuman") {
                                        self.status = AgentStatus::WaitingForHuman(args_str);
                                    }
                                }
                                Err(e) => {
                                    let err_msg = format!("System Error during tool execution: {}", e);
                                    self.append_history("tool", &err_msg)?;
                                    self.failed_tool_calls += 1;
                                }
                            }
                        } else {
                            let err_msg = format!("System Error: Tool '{}' not found. Check the schema.", tool_name);
                            self.append_history("tool", &err_msg)?;
                            self.failed_tool_calls += 1;
                        }
                    }
                    Err(e) => {
                        let err_msg = format!("System Error: Invalid JSON format ({}). Try again with valid JSON.", e);
                        self.log_malformed_and_prompt(&json_slice, &e.to_string(), &err_msg)?;
                    }
                }
        } else {
            let err_msg = "System Error: No valid JSON tool call found.";
            self.log_malformed_and_prompt(&llm_output, err_msg, err_msg)?;
        }

        if self.failed_tool_calls >= 3 {
            self.status = AgentStatus::WaitingForHuman("Execution paused due to 3 consecutive tool failures. Check context.".to_string());
        }

        let current_status = match &self.status {
            AgentStatus::Running => AgentStatus::Running,
            AgentStatus::WaitingForHuman(reason) => AgentStatus::WaitingForHuman(reason.clone()),
            AgentStatus::Completed => AgentStatus::Completed,
            AgentStatus::Error(e) => AgentStatus::Error(e.clone()),
        };
        Ok(current_status)
    }
}



#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_heuristic_repair_json() {
        // Test trailing commas removed
        let trailing = r#"{"a": 1, }"#;
        assert_eq!(heuristic_repair_json(trailing), r#"{"a": 1}"#);

        let trailing_arr = r#"[1, 2, ]"#;
        assert_eq!(heuristic_repair_json(trailing_arr), r#"[1, 2]"#);

        // Test unquoted keys fixed
        let unquoted = r#"{unquoted_key: "value"}"#;
        assert_eq!(heuristic_repair_json(unquoted), r#"{"unquoted_key": "value"}"#);

        // Test unquoted keys with spaces
        let unquoted_spaces = r#"{  spaced_key  : "value"}"#;
        assert_eq!(heuristic_repair_json(unquoted_spaces), r#"{  "spaced_key": "value"}"#);

        // Test combination
        let combo = r#"{key: "value", }"#;
        assert_eq!(heuristic_repair_json(combo), r#"{"key": "value"}"#);

        // Test missing closing quotes, braces, brackets
        let missing_quote = r#"{"key": "value"#;
        assert_eq!(heuristic_repair_json(missing_quote), r#"{"key": "value"}"#);

        let missing_brace = r#"{"key": "value""#;
        assert_eq!(heuristic_repair_json(missing_brace), r#"{"key": "value"}"#);

        let missing_bracket = r#"{"arr": [1, 2"#;
        assert_eq!(heuristic_repair_json(missing_bracket), r#"{"arr": [1, 2]}"#);

        let missing_multiple = r#"{"arr": [{"nested": "val"#;
        assert_eq!(heuristic_repair_json(missing_multiple), r#"{"arr": [{"nested": "val"}]}"#);
    }
}
