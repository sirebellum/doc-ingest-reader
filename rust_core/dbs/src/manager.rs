use rusqlite::Connection;
use contracts::error::AppError;
use std::path::Path;
use crate::schema::{INITIALIZE_DATABASE_SCHEMA, get_sync_triggers};

pub struct DatabaseManager {
    conn: Connection,
}

impl DatabaseManager {
    /// Opens or creates a database at the given path
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self, AppError> {
        let conn = Connection::open(path).map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    /// Opens an in-memory database
    pub fn open_in_memory() -> Result<Self, AppError> {
        let conn = Connection::open_in_memory().map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    /// Initializes the database schema using the imported SQL definitions
    fn init_schema(&self) -> Result<(), AppError> {
        // Execute the main schema
        self.conn
            .execute_batch(INITIALIZE_DATABASE_SCHEMA)
            .map_err(|e| AppError::DatabaseError(format!("Failed to initialize schema: {}", e)))?;
        
        // Execute the FTS5 sync triggers
        let triggers = get_sync_triggers();
        self.conn
            .execute_batch(&triggers)
            .map_err(|e| AppError::DatabaseError(format!("Failed to initialize FTS5 triggers: {}", e)))?;
        
        Ok(())
    }

    /// Exposes a simple FTS5 search operation as required
    pub fn search_blocks(&self, query: &str) -> Result<Vec<String>, AppError> {
        let mut stmt = self.conn.prepare("
            SELECT b.content 
            FROM blocks_fts f 
            JOIN blocks b ON f.block_id = b.id 
            WHERE blocks_fts MATCH ?
        ").map_err(|e| AppError::DatabaseError(e.to_string()))?;

        let rows = stmt.query_map([query], |row| {
            row.get::<_, String>(0)
        }).map_err(|e| AppError::DatabaseError(e.to_string()))?;

        let mut results = Vec::new();
        for row in rows {
            let content = row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
            results.push(content);
        }
        
        Ok(results)
    }
}

/// Initializes the temporary agent_db SQLite workspace using the canonical
/// schema, then adds agent-specific ephemeral tables.
pub fn init_agent_db(db: &Connection) -> Result<(), AppError> {
    // Load and execute the baseline schema
    db.execute_batch(crate::schema::INITIALIZE_DATABASE_SCHEMA)
        .map_err(|e| AppError::DatabaseError(format!("Failed to initialize base schema in agent db: {}", e)))?;
    
    // Add agent-specific ephemeral tables
    db.execute_batch(crate::schema::INITIALIZE_AGENT_DATABASE_SCHEMA)
        .map_err(|e| AppError::DatabaseError(format!("Failed to initialize agent db schema: {}", e)))?;

    Ok(())
}

/// Migrates relevant structure data from the ephemeral agent database to the persistent content database deterministically.
pub fn migrate_agent_to_content(agent_db_path: &str, content_db_path: &str, document_id: &str) -> Result<(), AppError> {
    // Open connection directly to content_db
    let mut content_db = Connection::open(content_db_path).map_err(|e| AppError::DatabaseError(e.to_string()))?;
    
    // Attach the ephemeral agent_db
    content_db.execute(&format!("ATTACH DATABASE '{}' AS scratch", agent_db_path), [])
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    
    let tx = content_db.transaction().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    
    // Perform atomic inserts from the scratch schema directly into the main schema
    tx.execute(
        "INSERT OR IGNORE INTO main.documents SELECT * FROM scratch.documents WHERE id = ?",
        [document_id],
    ).map_err(|e| AppError::DatabaseError(e.to_string()))?;

    tx.execute(
        "INSERT OR IGNORE INTO main.sections SELECT * FROM scratch.sections WHERE document_id = ?",
        [document_id],
    ).map_err(|e| AppError::DatabaseError(e.to_string()))?;

    tx.execute(
        "INSERT OR IGNORE INTO main.blocks SELECT * FROM scratch.blocks WHERE document_id = ?",
        [document_id],
    ).map_err(|e| AppError::DatabaseError(e.to_string()))?;

    tx.execute(
        "INSERT OR IGNORE INTO main.job_chunks SELECT * FROM scratch.job_chunks WHERE job_id IN (SELECT id FROM scratch.processing_jobs WHERE document_id = ?)",
        [document_id],
    ).map_err(|e| AppError::DatabaseError(e.to_string()))?;

    tx.execute(
        "INSERT OR IGNORE INTO main.processing_jobs SELECT * FROM scratch.processing_jobs WHERE document_id = ?",
        [document_id],
    ).map_err(|e| AppError::DatabaseError(e.to_string()))?;
    
    tx.commit().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    
    // Detach
    content_db.execute("DETACH DATABASE scratch", [])
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    
    // Wipe scratch database contents upon success
    let agent_db = Connection::open(agent_db_path).map_err(|e| AppError::DatabaseError(e.to_string()))?;
    agent_db.execute("DELETE FROM sections WHERE document_id = ?", [document_id]).ok();
    agent_db.execute("DELETE FROM blocks WHERE document_id = ?", [document_id]).ok();
    agent_db.execute("DELETE FROM pass1_chunks WHERE document_id = ?", [document_id]).ok();
    agent_db.execute("DELETE FROM conversation_history", []).ok();
    agent_db.execute("DELETE FROM processing_jobs WHERE document_id = ?", [document_id]).ok();
    agent_db.execute("DELETE FROM job_chunks WHERE job_id IN (SELECT id FROM processing_jobs WHERE document_id = ?)", [document_id]).ok();
    agent_db.execute("DELETE FROM job_queue WHERE document_id = ?", [document_id]).ok();
    agent_db.execute("DELETE FROM hypothesized_entities WHERE document_id = ?", [document_id]).ok();
    agent_db.execute("DELETE FROM scratch_vector_cache", []).ok();
    agent_db.execute("DELETE FROM tool_results_cache", []).ok();
    agent_db.execute("DELETE FROM malformed_blocks WHERE document_id = ?", [document_id]).ok();
    
    Ok(())
}
