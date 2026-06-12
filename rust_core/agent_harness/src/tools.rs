use anyhow::Result;
use rusqlite::Connection;

pub struct AgentDatabases {
    pub agent_db: Connection,
    pub content_db: Connection,
    pub agent_db_path: String,
    pub content_db_path: String,
    pub document_id: String,
}

pub trait AgentTool {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn execute(&self, args: &str, dbs: &AgentDatabases) -> Result<String>;
}

pub struct QueryAgentDB;
impl AgentTool for QueryAgentDB {
    fn name(&self) -> &str { "QueryAgentDB" }
    fn description(&self) -> &str { "Execute a SQL query against the temporary agent workspace database. Returns JSON rows." }
    fn execute(&self, args: &str, dbs: &AgentDatabases) -> Result<String> {
        let parsed: serde_json::Value = serde_json::from_str(args)?;
        let sql = parsed.get("sql").and_then(|v| v.as_str()).unwrap_or("");
        
        let mut stmt = dbs.agent_db.prepare(sql)?;
        
        if stmt.column_count() == 0 {
            let changed = stmt.execute([])?;
            return Ok(format!("{{\"status\": \"success\", \"rows_changed\": {}}}", changed));
        }
        
        let column_count = stmt.column_count();
        let mut rows = stmt.query([])?;
        let mut results = Vec::new();
        while let Some(row) = rows.next()? {
            let mut row_obj = serde_json::Map::new();
            for i in 0..column_count {
                let name = row.as_ref().column_name(i).unwrap_or("unknown");
                let val: rusqlite::types::Value = row.get(i)?;
                let json_val = match val {
                    rusqlite::types::Value::Null => serde_json::Value::Null,
                    rusqlite::types::Value::Integer(v) => serde_json::json!(v),
                    rusqlite::types::Value::Real(v) => serde_json::json!(v),
                    rusqlite::types::Value::Text(v) => serde_json::json!(v),
                    rusqlite::types::Value::Blob(v) => serde_json::json!(format!("<blob {} bytes>", v.len())),
                };
                row_obj.insert(name.to_string(), json_val);
            }
            results.push(serde_json::Value::Object(row_obj));
        }
        Ok(serde_json::to_string(&results)?)
    }
}

pub struct CreateNode;
impl AgentTool for CreateNode {
    fn name(&self) -> &str { "CreateNode" }
    fn description(&self) -> &str { "Create a semantic node (section or block)." }
    fn execute(&self, args: &str, dbs: &AgentDatabases) -> Result<String> {
        // Implement node creation
        let parsed: serde_json::Value = serde_json::from_str(args)?;
        let node_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("block");
        let id = parsed.get("id").and_then(|v| v.as_str()).unwrap_or("");
        
        if node_type == "section" {
            let title = parsed.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let parent_id = parsed.get("parent_id").and_then(|v| v.as_str());
            let depth_level = parsed.get("depth_level").and_then(|v| v.as_i64()).unwrap_or(1);
            let sort_order = parsed.get("sort_order").and_then(|v| v.as_i64()).unwrap_or(0);
            
            dbs.agent_db.execute(
                "INSERT INTO sections (id, document_id, parent_id, title, depth_level, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![id, dbs.document_id, parent_id, title, depth_level, sort_order]
            )?;
        } else {
            let section_id = parsed.get("section_id").and_then(|v| v.as_str());
            let block_type = parsed.get("block_type").and_then(|v| v.as_str()).unwrap_or("paragraph");
            let content = parsed.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let sort_order = parsed.get("sort_order").and_then(|v| v.as_i64()).unwrap_or(0);
            
            dbs.agent_db.execute(
                "INSERT INTO blocks (id, section_id, document_id, block_type, content, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![id, section_id, dbs.document_id, block_type, content, sort_order]
            )?;
        }
        
        Ok(format!("{{\"status\": \"success\", \"created_node_id\": \"{}\"}}", id))
    }
}

pub struct LinkNodes;
impl AgentTool for LinkNodes {
    fn name(&self) -> &str { "LinkNodes" }
    fn description(&self) -> &str { "Link two semantic nodes together (e.g. block to tag)." }
    fn execute(&self, args: &str, dbs: &AgentDatabases) -> Result<String> {
        let parsed: serde_json::Value = serde_json::from_str(args)?;
        let block_id = parsed.get("block_id").and_then(|v| v.as_str()).unwrap_or("");
        let tag_id = parsed.get("tag_id").and_then(|v| v.as_str()).unwrap_or("");
        
        dbs.agent_db.execute(
            "INSERT OR IGNORE INTO block_tags (block_id, tag_id) VALUES (?1, ?2)",
            rusqlite::params![block_id, tag_id]
        )?;
        Ok(format!("{{\"status\": \"success\", \"linked\": [\"{}\", \"{}\"]}}", block_id, tag_id))
    }
}

pub struct ParsingComplete;
impl AgentTool for ParsingComplete {
    fn name(&self) -> &str { "ParsingComplete" }
    fn description(&self) -> &str { "Call this tool with empty arguments when you have successfully mapped the document structure." }
    fn execute(&self, _args: &str, _dbs: &AgentDatabases) -> Result<String> {
        Ok("{\"status\": \"Parsing Complete Triggered\"}".to_string())
    }
}

pub struct AskHuman;
impl AgentTool for AskHuman {
    fn name(&self) -> &str { "AskHuman" }
    fn description(&self) -> &str { "Call this tool with a question string to pause execution and request input from the human operator." }
    fn execute(&self, args: &str, _dbs: &AgentDatabases) -> Result<String> {
        let parsed: serde_json::Value = serde_json::from_str(args)?;
        let question = parsed.get("question").and_then(|v| v.as_str()).unwrap_or("");
        
        Ok(format!("{{\"status\": \"Waiting for human\", \"question\": \"{}\"}}", question))
    }
}
