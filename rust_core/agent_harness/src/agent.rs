use anyhow::Result;
use crate::tools::{AgentDatabases, AgentTool, QueryAgentDB, CreateNode, LinkNodes, AskHuman, ParsingComplete};
use crate::migration::migrate_agent_to_content;

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
            Box::new(QueryAgentDB),
            Box::new(CreateNode),
            Box::new(LinkNodes),
            Box::new(AskHuman),
            Box::new(ParsingComplete),
        ];
        
        let id = uuid::Uuid::new_v4().to_string();
        let _ = dbs.agent_db.execute(
            "INSERT INTO agent_context (id, session_id, role, content) VALUES (?1, ?2, 'system', 'Agent Initialized')",
            rusqlite::params![id, "session_1"]
        );
        
        Self {
            databases: dbs,
            tools,
            status: AgentStatus::Running,
            failed_tool_calls: 0,
        }
    }

    fn append_history(&self, role: &str, content: &str) {
        let id = uuid::Uuid::new_v4().to_string();
        let _ = self.databases.agent_db.execute(
            "INSERT INTO agent_context (id, session_id, role, content) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![id, "session_1", role, content]
        );
    }

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

        // Mock LLM generation for scaffolding.
        // It would read from agent_context, call local model, and generate JSON.
        let llm_output = "{\"tool\": \"ParsingComplete\", \"args\": {}}".to_string();
        self.append_history("assistant", &llm_output);

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
                                    self.append_history("tool", &output);
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
                self.append_history("tool", "System Error: No valid JSON tool call found.");
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
