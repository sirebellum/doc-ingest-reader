use anyhow::Result;
use rusqlite::Connection;
use serde_json::Value;

pub struct AgentDatabases {
    pub agent_db: Connection,
    pub content_db: Connection,
}

pub trait AgentTool {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn execute(&self, args: &str, dbs: &AgentDatabases) -> Result<String>;
}

/// A generic tool to execute arbitrary read/write SQL against the agent DB
pub struct ExecuteAgentSQL;
impl AgentTool for ExecuteAgentSQL {
    fn name(&self) -> &str { "ExecuteAgentSQL" }
    fn description(&self) -> &str { "Executes arbitrary SQL against the temporary agent workspace database. Provide args as {\"sql\": \"YOUR SQL QUERY\"}." }
    fn execute(&self, args: &str, dbs: &AgentDatabases) -> Result<String> {
        let parsed: Value = serde_json::from_str(args)?;
        let sql = parsed.get("sql").and_then(|v| v.as_str()).unwrap_or("");
        
        let mut stmt = dbs.agent_db.prepare(sql)?;
        
        if stmt.column_count() == 0 {
            // It's a write query
            let changed = stmt.execute([])?;
            return Ok(format!("{{\"status\": \"success\", \"rows_changed\": {}}}", changed));
        }
        
        // It's a read query
        let column_count = stmt.column_count();
        let mut rows = stmt.query([])?;
        let mut results = Vec::new();
        while let Some(row) = rows.next()? {
            let mut row_obj = serde_json::Map::new();
            for i in 0..column_count {
                let name = row.as_ref().column_name(i).unwrap_or("unknown");
                let val: rusqlite::types::Value = row.get(i)?;
                let json_val = match val {
                    rusqlite::types::Value::Null => Value::Null,
                    rusqlite::types::Value::Integer(v) => serde_json::json!(v),
                    rusqlite::types::Value::Real(v) => serde_json::json!(v),
                    rusqlite::types::Value::Text(v) => serde_json::json!(v),
                    rusqlite::types::Value::Blob(v) => serde_json::json!(format!("<blob {} bytes>", v.len())),
                };
                row_obj.insert(name.to_string(), json_val);
            }
            results.push(Value::Object(row_obj));
        }
        Ok(serde_json::to_string(&results)?)
    }
}

/// Read-only SQL tool for the content DB
pub struct QueryContentDB;
impl AgentTool for QueryContentDB {
    fn name(&self) -> &str { "QueryContentDB" }
    fn description(&self) -> &str { "Execute a read-only SQL query against the official content database. Provide args as {\"sql\": \"YOUR SQL QUERY\"}." }
    fn execute(&self, args: &str, dbs: &AgentDatabases) -> Result<String> {
        let parsed: Value = serde_json::from_str(args)?;
        let sql = parsed.get("sql").and_then(|v| v.as_str()).unwrap_or("");
        
        let mut stmt = dbs.content_db.prepare(sql)?;
        let column_count = stmt.column_count();
        let mut rows = stmt.query([])?;
        let mut results = Vec::new();
        while let Some(row) = rows.next()? {
            let mut row_obj = serde_json::Map::new();
            for i in 0..column_count {
                let name = row.as_ref().column_name(i).unwrap_or("unknown");
                let val: rusqlite::types::Value = row.get(i)?;
                let json_val = match val {
                    rusqlite::types::Value::Null => Value::Null,
                    rusqlite::types::Value::Integer(v) => serde_json::json!(v),
                    rusqlite::types::Value::Real(v) => serde_json::json!(v),
                    rusqlite::types::Value::Text(v) => serde_json::json!(v),
                    rusqlite::types::Value::Blob(v) => serde_json::json!(format!("<blob {} bytes>", v.len())),
                };
                row_obj.insert(name.to_string(), json_val);
            }
            results.push(Value::Object(row_obj));
        }
        Ok(serde_json::to_string(&results)?)
    }
}

/// Structured tool to insert an agent_section
pub struct InsertAgentSection;
impl AgentTool for InsertAgentSection {
    fn name(&self) -> &str { "InsertAgentSection" }
    fn description(&self) -> &str { "Insert a new section into agent_sections. Args: {\"id\":\"...\", \"document_id\":\"...\", \"parent_id\":null, \"title\":\"...\", \"depth_level\":1, \"sort_order\":1, \"sequence_order\":1}" }
    fn execute(&self, args: &str, dbs: &AgentDatabases) -> Result<String> {
        let parsed: Value = serde_json::from_str(args)?;
        
        let id = parsed.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let doc_id = parsed.get("document_id").and_then(|v| v.as_str()).unwrap_or("");
        let parent_id = parsed.get("parent_id").and_then(|v| v.as_str());
        let title = parsed.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let depth = parsed.get("depth_level").and_then(|v| v.as_i64()).unwrap_or(1);
        let sort = parsed.get("sort_order").and_then(|v| v.as_i64()).unwrap_or(0);
        let seq = parsed.get("sequence_order").and_then(|v| v.as_i64()).unwrap_or(0);
        
        dbs.agent_db.execute(
            "INSERT INTO agent_sections (id, document_id, parent_id, title, depth_level, sort_order, sequence_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![id, doc_id, parent_id, title, depth, sort, seq]
        )?;
        
        Ok(format!("{{\"status\": \"success\", \"inserted_section_id\": \"{}\"}}", id))
    }
}

/// Structured tool to insert an agent_block
pub struct InsertAgentBlock;
impl AgentTool for InsertAgentBlock {
    fn name(&self) -> &str { "InsertAgentBlock" }
    fn description(&self) -> &str { "Insert a new block into agent_blocks. Args: {\"id\":\"...\", \"section_id\":\"...\", \"document_id\":\"...\", \"block_type\":\"paragraph\", \"content\":\"...\", \"sort_order\":1, \"sequence_order\":1}" }
    fn execute(&self, args: &str, dbs: &AgentDatabases) -> Result<String> {
        let parsed: Value = serde_json::from_str(args)?;
        
        let id = parsed.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let sec_id = parsed.get("section_id").and_then(|v| v.as_str()).unwrap_or("");
        let doc_id = parsed.get("document_id").and_then(|v| v.as_str()).unwrap_or("");
        let btype = parsed.get("block_type").and_then(|v| v.as_str()).unwrap_or("paragraph");
        let content = parsed.get("content").and_then(|v| v.as_str()).unwrap_or("");
        let sort = parsed.get("sort_order").and_then(|v| v.as_i64()).unwrap_or(0);
        let seq = parsed.get("sequence_order").and_then(|v| v.as_i64()).unwrap_or(0);
        
        dbs.agent_db.execute(
            "INSERT INTO agent_blocks (id, section_id, document_id, block_type, content, sort_order, sequence_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![id, sec_id, doc_id, btype, content, sort, seq]
        )?;
        
        Ok(format!("{{\"status\": \"success\", \"inserted_block_id\": \"{}\"}}", id))
    }
}

pub struct ParsingComplete;
impl AgentTool for ParsingComplete {
    fn name(&self) -> &str { "ParsingComplete" }
    fn description(&self) -> &str { "Call this tool with {\"message\": \"done\"} when you have successfully mapped the document structure." }
    fn execute(&self, _args: &str, _dbs: &AgentDatabases) -> Result<String> {
        Ok("{\"status\": \"Parsing Complete Triggered\"}".to_string())
    }
}

pub struct AskHuman;
impl AgentTool for AskHuman {
    fn name(&self) -> &str { "AskHuman" }
    fn description(&self) -> &str { "Call this tool with {\"question\": \"...\", \"context\": \"...\"} to pause execution and insert a request into agent_human_interactions." }
    fn execute(&self, args: &str, dbs: &AgentDatabases) -> Result<String> {
        let parsed: Value = serde_json::from_str(args)?;
        let question = parsed.get("question").and_then(|v| v.as_str()).unwrap_or("");
        let context = parsed.get("context").and_then(|v| v.as_str()).unwrap_or("");
        
        let id = format!("hum-{}", uuid::Uuid::new_v4());
        
        dbs.agent_db.execute(
            "INSERT INTO agent_human_interactions (id, question, context, status) VALUES (?1, ?2, ?3, 'pending')",
            rusqlite::params![id, question, context]
        )?;
        
        Ok(format!("{{\"status\": \"Waiting for human\", \"interaction_id\": \"{}\"}}", id))
    }
}
