use contracts::error::AppError;
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
    fn execute(&self, args: &str, dbs: &AgentDatabases) -> Result<String, AppError>;
}

pub struct QueryVectorDB;
impl AgentTool for QueryVectorDB {
    fn name(&self) -> &str { "query_vector_db" }
    fn description(&self) -> &str { "Query the vector database for relevant chunks from pass 1 based on a semantic search string." }
    fn execute(&self, args: &str, dbs: &AgentDatabases) -> Result<String, AppError> {
        let parsed: serde_json::Value = serde_json::from_str(args)?;
        let query = parsed.get("query").and_then(|v| v.as_str()).unwrap_or("");
        
        let sql = "SELECT id, raw_layout_text FROM pass1_chunks WHERE document_id = ? AND raw_layout_text LIKE ? LIMIT 5";
        let mut stmt = dbs.agent_db.prepare(sql).map_err(|e| AppError::DatabaseError(e.to_string()))?;
        
        let mut rows = stmt.query(rusqlite::params![dbs.document_id, format!("%{}%", query)]).map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let mut results = Vec::new();
        while let Some(row) = rows.next().map_err(|e| AppError::DatabaseError(e.to_string()))? {
            let id: String = row.get(0).map_err(|e| AppError::DatabaseError(e.to_string()))?;
            let text: String = row.get(1).map_err(|e| AppError::DatabaseError(e.to_string()))?;
            results.push(serde_json::json!({
                "id": id,
                "text": text
            }));
        }
        Ok(serde_json::to_string(&results)?)
    }
}

pub struct ReadContentDB;
impl AgentTool for ReadContentDB {
    fn name(&self) -> &str { "read_content_db" }
    fn description(&self) -> &str { "Read specific pass 1 chunks by ID." }
    fn execute(&self, args: &str, dbs: &AgentDatabases) -> Result<String, AppError> {
        let parsed: serde_json::Value = serde_json::from_str(args)?;
        let chunk_id = parsed.get("chunk_id").and_then(|v| v.as_str()).unwrap_or("");
        
        let sql = "SELECT id, raw_layout_text FROM pass1_chunks WHERE id = ?";
        let mut stmt = dbs.agent_db.prepare(sql).map_err(|e| AppError::DatabaseError(e.to_string()))?;
        
        let mut rows = stmt.query(rusqlite::params![chunk_id]).map_err(|e| AppError::DatabaseError(e.to_string()))?;
        if let Some(row) = rows.next().map_err(|e| AppError::DatabaseError(e.to_string()))? {
            let id: String = row.get(0).map_err(|e| AppError::DatabaseError(e.to_string()))?;
            let text: String = row.get(1).map_err(|e| AppError::DatabaseError(e.to_string()))?;
            return Ok(serde_json::to_string(&serde_json::json!({
                "id": id,
                "text": text
            }))?);
        }
        
        Ok("{\"error\": \"Chunk not found\"}".to_string())
    }
}


pub struct QueryAgentDB;
impl AgentTool for QueryAgentDB {
    fn name(&self) -> &str { "QueryAgentDB" }
    fn description(&self) -> &str { "Execute a SQL query against the temporary agent workspace database. Returns JSON rows." }
    fn execute(&self, args: &str, dbs: &AgentDatabases) -> Result<String, AppError> {
        let parsed: serde_json::Value = serde_json::from_str(args)?;
        let sql = parsed.get("sql").and_then(|v| v.as_str()).unwrap_or("");
        
        let mut stmt = dbs.agent_db.prepare(sql).map_err(|e| AppError::DatabaseError(e.to_string()))?;
        
        if stmt.column_count() == 0 {
            let changed = stmt.execute([]).map_err(|e| AppError::DatabaseError(e.to_string()))?;
            return Ok(format!("{{\"status\": \"success\", \"rows_changed\": {}}}", changed));
        }
        
        let column_count = stmt.column_count();
        let mut rows = stmt.query([]).map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let mut results = Vec::new();
        while let Some(row) = rows.next().map_err(|e| AppError::DatabaseError(e.to_string()))? {
            let mut row_obj = serde_json::Map::new();
            for i in 0..column_count {
                let name = row.as_ref().column_name(i).unwrap_or("unknown");
                let val: rusqlite::types::Value = row.get(i).map_err(|e| AppError::DatabaseError(e.to_string()))?;
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
    fn execute(&self, args: &str, dbs: &AgentDatabases) -> Result<String, AppError> {
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
            ).map_err(|e| AppError::DatabaseError(e.to_string()))?;
        } else {
            let section_id = parsed.get("section_id").and_then(|v| v.as_str());
            let block_type = parsed.get("block_type").and_then(|v| v.as_str()).unwrap_or("paragraph");
            let content = parsed.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let sort_order = parsed.get("sort_order").and_then(|v| v.as_i64()).unwrap_or(0);
            
            dbs.agent_db.execute(
                "INSERT INTO blocks (id, section_id, document_id, block_type, content, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![id, section_id, dbs.document_id, block_type, content, sort_order]
            ).map_err(|e| AppError::DatabaseError(e.to_string()))?;
        }
        
        Ok(serde_json::json!({"status": "success", "created_node_id": id}).to_string())
    }
}

pub struct LinkNodes;
impl AgentTool for LinkNodes {
    fn name(&self) -> &str { "LinkNodes" }
    fn description(&self) -> &str { "Link two semantic nodes together (e.g. block to tag)." }
    fn execute(&self, args: &str, dbs: &AgentDatabases) -> Result<String, AppError> {
        let parsed: serde_json::Value = serde_json::from_str(args)?;
        let block_id = parsed.get("block_id").and_then(|v| v.as_str()).unwrap_or("");
        let tag_id = parsed.get("tag_id").and_then(|v| v.as_str()).unwrap_or("");
        
        dbs.agent_db.execute(
            "INSERT OR IGNORE INTO block_tags (block_id, tag_id) VALUES (?1, ?2)",
            rusqlite::params![block_id, tag_id]
        ).map_err(|e| AppError::DatabaseError(e.to_string()))?;
        Ok(serde_json::json!({"status": "success", "linked": [block_id, tag_id]}).to_string())
    }
}

pub struct ParsingComplete;
impl AgentTool for ParsingComplete {
    fn name(&self) -> &str { "ParsingComplete" }
    fn description(&self) -> &str { "Call this tool with empty arguments when you have successfully mapped the document structure." }
    fn execute(&self, _args: &str, _dbs: &AgentDatabases) -> Result<String, AppError> {
        Ok("{\"status\": \"Parsing Complete Triggered\"}".to_string())
    }
}

pub struct AskHuman;
impl AgentTool for AskHuman {
    fn name(&self) -> &str { "AskHuman" }
    fn description(&self) -> &str { "Call this tool with a question string to pause execution and request input from the human operator." }
    fn execute(&self, args: &str, _dbs: &AgentDatabases) -> Result<String, AppError> {
        let parsed: serde_json::Value = serde_json::from_str(args)?;
        let question = parsed.get("question").and_then(|v| v.as_str()).unwrap_or("");
        
        Ok(serde_json::json!({"status": "Waiting for human", "question": question}).to_string())
    }
}

pub struct CreateTag;
impl AgentTool for CreateTag {
    fn name(&self) -> &str { "CreateTag" }
    fn description(&self) -> &str { "Create a new tag to associate with blocks." }
    fn execute(&self, args: &str, dbs: &AgentDatabases) -> Result<String, AppError> {
        let parsed: serde_json::Value = serde_json::from_str(args)?;
        let id = parsed.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let name = parsed.get("name").and_then(|v| v.as_str()).unwrap_or("");
        
        dbs.agent_db.execute(
            "INSERT INTO tags (id, name, source) VALUES (?1, ?2, 'agent')",
            rusqlite::params![id, name]
        ).map_err(|e| AppError::DatabaseError(e.to_string()))?;
        
        Ok(serde_json::json!({"status": "success", "created_tag_id": id}).to_string())
    }
}
