use anyhow::Result;
use crate::tools::{AgentDatabases, AgentTool, ExecuteAgentSQL, QueryContentDB, InsertAgentSection, InsertAgentBlock, ParsingComplete, AskHuman};
use crate::migration::migrate_agent_data_to_content_db;
use crate::prompt::AGENT_SYSTEM_PROMPT;
use serde_json::Value;

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
}

impl AgentState {
    pub fn new(dbs: AgentDatabases) -> Self {
        let tools: Vec<Box<dyn AgentTool>> = vec![
            Box::new(ExecuteAgentSQL),
            Box::new(QueryContentDB),
            Box::new(InsertAgentSection),
            Box::new(InsertAgentBlock),
            Box::new(ParsingComplete),
            Box::new(AskHuman),
        ];
        
        // Ensure system prompt is logged in conversation history (mock start)
        let _ = dbs.agent_db.execute(
            "INSERT INTO agent_conversation_history (role, content) VALUES ('system', ?1)",
            rusqlite::params![AGENT_SYSTEM_PROMPT]
        );
        
        Self {
            databases: dbs,
            tools,
            status: AgentStatus::Running,
            failed_tool_calls: 0,
        }
    }

    /// Appends a message to the agent's conversation history
    fn append_history(&self, role: &str, content: &str) {
        let _ = self.databases.agent_db.execute(
            "INSERT INTO agent_conversation_history (role, content) VALUES (?1, ?2)",
            rusqlite::params![role, content]
        );
    }

    /// Primary ReAct execution loop step.
    pub fn step(&mut self) -> Result<AgentStatus> {
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

        // Retrieve full conversation history (up to last 100 turns for safety)
        let mut stmt = self.databases.agent_db.prepare(
            "SELECT role, content FROM agent_conversation_history ORDER BY id ASC LIMIT 100"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(format!("{}: {}", row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        
        let mut prompt_context = String::new();
        for row in rows {
            if let Ok(msg) = row {
                prompt_context.push_str(&msg);
                prompt_context.push('\n');
            }
        }
        
        prompt_context.push_str("\nGenerate your next tool call as a JSON block.");

        // Here we would call the LLM: 
        // let output_str = inference::run_local_inference("agent-session", &prompt_context)?;
        // For scaffold purposes, we simulate LLM output. In production, connect this to `inference::run_local_inference`.
        let llm_output = "{\"tool\": \"ParsingComplete\", \"args\": {}}".to_string(); // Mocked output
        
        self.append_history("assistant", &llm_output);

        // Parse tool call with robust error handling
        let json_start = llm_output.find('{');
        let json_end = llm_output.rfind('}');
        
        if let (Some(start), Some(end)) = (json_start, json_end) {
            if start < end {
                let json_slice = &llm_output[start..=end];
                match serde_json::from_str::<Value>(json_slice) {
                    Ok(parsed) => {
                        let tool_name = parsed.get("tool").and_then(|v| v.as_str()).unwrap_or("");
                        let args = parsed.get("args").unwrap_or(&Value::Null);
                        let args_str = args.to_string();

                        if let Some(tool) = self.tools.iter().find(|t| t.name() == tool_name) {
                            match tool.execute(&args_str, &self.databases) {
                                Ok(output) => {
                                    self.append_history("tool", &output);
                                    self.failed_tool_calls = 0; // Reset
                                    
                                    if tool_name == "ParsingComplete" {
                                        let _ = migrate_agent_data_to_content_db(&self.databases.agent_db, &self.databases.content_db);
                                        self.status = AgentStatus::Completed;
                                    } else if tool_name == "AskHuman" {
                                        self.status = AgentStatus::WaitingForHuman(args_str);
                                    }
                                }
                                Err(e) => {
                                    let err_msg = format!("System Error during tool execution: {}", e);
                                    self.append_history("tool", &err_msg);
                                    self.failed_tool_calls += 1;
                                }
                            }
                        } else {
                            let err_msg = format!("System Error: Tool '{}' not found. Check the schema.", tool_name);
                            self.append_history("tool", &err_msg);
                            self.failed_tool_calls += 1;
                        }
                    }
                    Err(e) => {
                        let err_msg = format!("System Error: Invalid JSON format ({}). Try again with valid JSON.", e);
                        self.append_history("tool", &err_msg);
                        self.failed_tool_calls += 1;
                    }
                }
            } else {
                self.append_history("tool", "System Error: No valid JSON tool call found. Did you forget to output the JSON block?");
                self.failed_tool_calls += 1;
            }
        } else {
            self.append_history("tool", "System Error: No valid JSON tool call found.");
            self.failed_tool_calls += 1;
        }

        if self.failed_tool_calls >= 5 {
            self.status = AgentStatus::WaitingForHuman("Execution paused due to 5 consecutive tool failures. Check context.".to_string());
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
