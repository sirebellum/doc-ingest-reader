use contracts::error::AppError;
use crate::tools::{AgentDatabases, AgentTool, QueryAgentDB, CreateNode, LinkNodes, AskHuman, ParsingComplete};
use dbs::manager::migrate_agent_to_content;

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
    pub fn new(dbs: AgentDatabases) -> Self {
        let tools: Vec<Box<dyn AgentTool>> = vec![
            Box::new(QueryAgentDB),
            Box::new(CreateNode),
            Box::new(LinkNodes),
            Box::new(AskHuman),
            Box::new(ParsingComplete),
            Box::new(crate::tools::QueryVectorDB),
            Box::new(crate::tools::ReadContentDB),
        ];
        
        let id = uuid::Uuid::new_v4().to_string();
        let _ = dbs.agent_db.execute(
            "INSERT INTO conversation_history (id, session_id, role, content) VALUES (?1, ?2, 'system', 'Agent Initialized')",
            rusqlite::params![id, "session_1"]
        );
        
        Self {
            databases: dbs,
            tools,
            status: AgentStatus::Running,
            failed_tool_calls: 0,
            inference_override: None,
        }
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
                    history.push_str(&format!("{}: {}\n", role, content));
                }
            }
        }

        let tools_desc = self.tools.iter()
            .map(|t| format!("- {}: {}", t.name(), t.description()))
            .collect::<Vec<_>>()
            .join("\n");

        let prompt = format!(
            "{}\n\nAvailable tools:\n{}\n\nYou must output your action as a JSON object: {{\"tool\": \"ToolName\", \"args\": {{\"arg1\": \"value1\"}}}}\nOnly output the JSON object. Do not output any markdown formatting.",
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

        self.append_history("assistant", &llm_output)?;

        let json_start = llm_output.find('{');
        let json_end = llm_output.rfind('}');

        if let (Some(start), Some(end)) = (json_start, json_end) {
            if start < end {
                let json_slice = &llm_output[start..=end];
                match serde_json::from_str::<serde_json::Value>(json_slice) {
                    Ok(parsed) => {
                        let tool_name = parsed.get("tool").and_then(|v| v.as_str()).unwrap_or("");
                        let args = parsed.get("args").unwrap_or(&serde_json::Value::Null);
                        let args_str = args.to_string();

                        if let Some(tool) = self.tools.iter().find(|t| t.name() == tool_name) {
                            match tool.execute(&args_str, &self.databases) {
                                Ok(output) => {
                                    self.append_history("tool", &output)?;
                                    self.failed_tool_calls = 0; // Reset
                                    
                                    if tool_name == "ParsingComplete" {
                                        let _ = migrate_agent_to_content(
                                            &self.databases.agent_db_path,
                                            &self.databases.content_db_path,
                                            &self.databases.document_id
                                        );
                                        self.status = AgentStatus::Completed;
                                    } else if tool_name == "AskHuman" {
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
                        self.log_malformed_and_prompt(json_slice, &e.to_string(), &err_msg)?;
                    }
                }
            } else {
                let err_msg = "System Error: No valid JSON tool call found.";
                self.log_malformed_and_prompt(&llm_output, err_msg, err_msg)?;
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
    use rusqlite::Connection;
    use tempfile::NamedTempFile;
    use dbs::manager::init_agent_db;

    fn setup_test_state() -> (AgentState, NamedTempFile, NamedTempFile) {
        let content_file = NamedTempFile::new().unwrap();
        let agent_file = NamedTempFile::new().unwrap();

        let content_db = Connection::open(content_file.path()).unwrap();
        let agent_db = Connection::open(agent_file.path()).unwrap();

        // Initialize schema for agent_db
        init_agent_db(&agent_db).unwrap();

        // Create table needed for migration tests
        content_db.execute(
            "CREATE TABLE IF NOT EXISTS sections (id TEXT PRIMARY KEY, document_id TEXT, parent_id TEXT, title TEXT, depth_level INTEGER, sort_order INTEGER)",
            []
        ).unwrap();

        let dbs = AgentDatabases {
            agent_db,
            content_db,
            agent_db_path: agent_file.path().to_string_lossy().to_string(),
            content_db_path: content_file.path().to_string_lossy().to_string(),
            document_id: "test_doc_123".to_string(),
        };

        let state = AgentState::new(dbs);
        (state, content_file, agent_file)
    }

    #[test]
    fn test_agent_initialization() {
        let (state, _c, _a) = setup_test_state();
        assert_eq!(state.status, AgentStatus::Running);
        assert_eq!(state.failed_tool_calls, 0);

        // Check history
        let count: i64 = state.databases.agent_db.query_row(
            "SELECT count(*) FROM conversation_history WHERE session_id = 'session_1'",
            [],
            |row| row.get(0)
        ).unwrap();
        assert_eq!(count, 1, "Agent initialized should append to history");
    }

    #[test]
    fn test_agent_successful_tool_call() {
        let (mut state, _c, _a) = setup_test_state();
        state.inference_override = Some(|_prompt| {
            Ok(r#"{"tool": "AskHuman", "args": {"question": "Hello?"}}"#.to_string())
        });

        let status = state.step().unwrap();
        assert_eq!(status, AgentStatus::WaitingForHuman(r#"{"question":"Hello?"}"#.to_string()));
        assert_eq!(state.status, AgentStatus::WaitingForHuman(r#"{"question":"Hello?"}"#.to_string()));
        assert_eq!(state.failed_tool_calls, 0);
    }

    #[test]
    fn test_agent_malformed_json() {
        let (mut state, _c, _a) = setup_test_state();
        state.inference_override = Some(|_prompt| {
            Ok(r#"{"tool": "AskHuman", "args": {"question": "Missing quote}}"#.to_string())
        });

        let status = state.step().unwrap();
        assert_eq!(status, AgentStatus::Running);
        assert_eq!(state.failed_tool_calls, 1);

        // Verify malformed blocks log
        let count: i64 = state.databases.agent_db.query_row(
            "SELECT count(*) FROM malformed_blocks WHERE document_id = 'test_doc_123'",
            [],
            |row| row.get(0)
        ).unwrap();
        assert_eq!(count, 1, "Should log malformed block");
    }

    #[test]
    fn test_agent_no_json() {
        let (mut state, _c, _a) = setup_test_state();
        state.inference_override = Some(|_prompt| {
            Ok("Just plain text with no json".to_string())
        });

        let status = state.step().unwrap();
        assert_eq!(status, AgentStatus::Running);
        assert_eq!(state.failed_tool_calls, 1);
    }

    #[test]
    fn test_agent_consecutive_failures_pause() {
        let (mut state, _c, _a) = setup_test_state();
        state.inference_override = Some(|_prompt| {
            Ok("Garbage output".to_string())
        });

        // 1st failure
        state.step().unwrap();
        assert_eq!(state.failed_tool_calls, 1);

        // 2nd failure
        state.step().unwrap();
        assert_eq!(state.failed_tool_calls, 2);

        // 3rd failure -> changes state to WaitingForHuman
        let status = state.step().unwrap();
        assert!(matches!(status, AgentStatus::WaitingForHuman(_)));
        assert_eq!(state.failed_tool_calls, 3);
    }

    #[test]
    fn test_parsing_complete_completes_agent() {
        let (mut state, _c, _a) = setup_test_state();
        state.inference_override = Some(|_prompt| {
            Ok(r#"{"tool": "ParsingComplete", "args": {}}"#.to_string())
        });

        let status = state.step().unwrap();
        assert_eq!(status, AgentStatus::Completed);
        assert_eq!(state.status, AgentStatus::Completed);
    }
}

