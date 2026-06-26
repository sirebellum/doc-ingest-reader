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
        "INSERT INTO main.documents SELECT * FROM scratch.documents WHERE id = ?
         ON CONFLICT(id) DO UPDATE SET
            corpus_id = excluded.corpus_id,
            title = excluded.title,
            author = excluded.author,
            source_type = excluded.source_type,
            sha256_hash = excluded.sha256_hash,
            metadata = excluded.metadata,
            storage_path = excluded.storage_path,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at",
        [document_id],
    ).map_err(|e| AppError::DatabaseError(e.to_string()))?;

    tx.execute(
        "INSERT INTO main.sections SELECT * FROM scratch.sections WHERE document_id = ?
         ON CONFLICT(id) DO UPDATE SET
            document_id = excluded.document_id,
            parent_id = excluded.parent_id,
            title = excluded.title,
            depth_level = excluded.depth_level,
            sort_order = excluded.sort_order,
            created_at = excluded.created_at",
        [document_id],
    ).map_err(|e| AppError::DatabaseError(e.to_string()))?;

    tx.execute(
        "INSERT INTO main.blocks SELECT * FROM scratch.blocks WHERE document_id = ?
         ON CONFLICT(id) DO UPDATE SET
            section_id = excluded.section_id,
            document_id = excluded.document_id,
            block_type = excluded.block_type,
            content = excluded.content,
            sort_order = excluded.sort_order,
            token_count = excluded.token_count,
            created_at = excluded.created_at",
        [document_id],
    ).map_err(|e| AppError::DatabaseError(e.to_string()))?;

    tx.execute(
        "INSERT INTO main.processing_jobs SELECT * FROM scratch.processing_jobs WHERE document_id = ?
         ON CONFLICT(id) DO UPDATE SET
            document_id = excluded.document_id,
            status = excluded.status,
            progress_percentage = excluded.progress_percentage,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at",
        [document_id],
    ).map_err(|e| AppError::DatabaseError(e.to_string()))?;

    tx.execute(
        "INSERT INTO main.job_chunks SELECT * FROM scratch.job_chunks WHERE job_id IN (SELECT id FROM scratch.processing_jobs WHERE document_id = ?)
         ON CONFLICT(id) DO UPDATE SET
            job_id = excluded.job_id,
            raw_text = excluded.raw_text,
            chunk_order = excluded.chunk_order,
            status = excluded.status,
            processed_blocks = excluded.processed_blocks",
        [document_id],
    ).map_err(|e| AppError::DatabaseError(e.to_string()))?;

    tx.execute(
        "INSERT INTO main.tags SELECT * FROM scratch.tags WHERE 1=1
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name",
        [],
    ).map_err(|e| AppError::DatabaseError(e.to_string()))?;

    tx.execute(
        "INSERT INTO main.block_tags SELECT * FROM scratch.block_tags WHERE 1=1
         ON CONFLICT(block_id, tag_id) DO NOTHING",
        [],
    ).map_err(|e| AppError::DatabaseError(e.to_string()))?;

    tx.execute(
        "INSERT INTO main.annotations SELECT * FROM scratch.annotations WHERE document_id = ?
         ON CONFLICT(id) DO UPDATE SET
            note_body = excluded.note_body,
            highlighted_text = excluded.highlighted_text,
            anchor_metadata = excluded.anchor_metadata,
            updated_at = excluded.updated_at",
        [document_id],
    ).map_err(|e| AppError::DatabaseError(e.to_string()))?;

    tx.execute(
        "INSERT INTO main.layout_height_cache SELECT * FROM scratch.layout_height_cache WHERE 1=1
         ON CONFLICT(block_id) DO UPDATE SET
            estimated_height = excluded.estimated_height",
        [],
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
    agent_db.execute("DELETE FROM job_chunks WHERE job_id IN (SELECT id FROM processing_jobs WHERE document_id = ?)", [document_id]).ok();
    agent_db.execute("DELETE FROM processing_jobs WHERE document_id = ?", [document_id]).ok();
    agent_db.execute("DELETE FROM job_queue WHERE document_id = ?", [document_id]).ok();
    agent_db.execute("DELETE FROM hypothesized_entities WHERE document_id = ?", [document_id]).ok();
    agent_db.execute("DELETE FROM scratch_vector_cache", []).ok();
    agent_db.execute("DELETE FROM tool_results_cache", []).ok();
    agent_db.execute("DELETE FROM malformed_blocks WHERE document_id = ?", [document_id]).ok();
    agent_db.execute("DELETE FROM tags", []).ok();
    agent_db.execute("DELETE FROM block_tags", []).ok();
    agent_db.execute("DELETE FROM annotations WHERE document_id = ?", [document_id]).ok();
    agent_db.execute("DELETE FROM layout_height_cache", []).ok();
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use tempfile::NamedTempFile;
    use crate::schema::INITIALIZE_DATABASE_SCHEMA;

    #[test]
    fn test_migrate_agent_to_content_upsert() {
        let content_file = NamedTempFile::new().unwrap();
        let agent_file = NamedTempFile::new().unwrap();

        let agent_db_path = agent_file.path().to_str().unwrap();
        let content_db_path = content_file.path().to_str().unwrap();

        let content_db = Connection::open(content_db_path).unwrap();
        let agent_db = Connection::open(agent_db_path).unwrap();

        // Initialize schemas
        content_db.execute_batch(INITIALIZE_DATABASE_SCHEMA).unwrap();
        init_agent_db(&agent_db).unwrap();

        // 1. Initial Insert
        content_db.execute("INSERT INTO corpora (id, name) VALUES ('corp1', 'Test Corpus')", []).unwrap();
        agent_db.execute("INSERT INTO corpora (id, name) VALUES ('corp1', 'Test Corpus')", []).unwrap();

        agent_db.execute("INSERT INTO documents (id, corpus_id, title, sha256_hash, storage_path) VALUES ('doc1', 'corp1', 'Old Title', 'hash1', '/path')", []).unwrap();
        agent_db.execute("INSERT INTO sections (id, document_id, parent_id, title, depth_level, sort_order) VALUES ('sec1', 'doc1', NULL, 'Old Section', 1, 0)", []).unwrap();
        agent_db.execute("INSERT INTO blocks (id, section_id, document_id, block_type, content, sort_order) VALUES ('blk1', 'sec1', 'doc1', 'paragraph', 'Old Content', 0)", []).unwrap();

        migrate_agent_to_content(agent_db_path, content_db_path, "doc1").unwrap();

        // Check initial migration
        let doc_title: String = content_db.query_row("SELECT title FROM documents WHERE id = 'doc1'", [], |r| r.get(0)).unwrap();
        assert_eq!(doc_title, "Old Title");
        let sec_title: String = content_db.query_row("SELECT title FROM sections WHERE id = 'sec1'", [], |r| r.get(0)).unwrap();
        assert_eq!(sec_title, "Old Section");
        let blk_content: String = content_db.query_row("SELECT content FROM blocks WHERE id = 'blk1'", [], |r| r.get(0)).unwrap();
        assert_eq!(blk_content, "Old Content");

        // 2. Modify scratch database to test UPSERT logic (simulate re-processing)
        // (Note: migrate_agent_to_content clears the agent DB on success, except for documents, so we update it, but re-insert others)
        agent_db.execute("UPDATE documents SET title = 'New Title' WHERE id = 'doc1'", []).unwrap();
        agent_db.execute("INSERT INTO sections (id, document_id, parent_id, title, depth_level, sort_order) VALUES ('sec1', 'doc1', NULL, 'New Section', 1, 0)", []).unwrap();
        agent_db.execute("INSERT INTO blocks (id, section_id, document_id, block_type, content, sort_order) VALUES ('blk1', 'sec1', 'doc1', 'paragraph', 'New Content', 0)", []).unwrap();

        migrate_agent_to_content(agent_db_path, content_db_path, "doc1").unwrap();

        // Check UPSERT migration
        let doc_title: String = content_db.query_row("SELECT title FROM documents WHERE id = 'doc1'", [], |r| r.get(0)).unwrap();
        assert_eq!(doc_title, "New Title");
        let sec_title: String = content_db.query_row("SELECT title FROM sections WHERE id = 'sec1'", [], |r| r.get(0)).unwrap();
        assert_eq!(sec_title, "New Section");
        let blk_content: String = content_db.query_row("SELECT content FROM blocks WHERE id = 'blk1'", [], |r| r.get(0)).unwrap();
        assert_eq!(blk_content, "New Content");
    }

    #[test]
    fn test_migrate_agent_to_content_all_tables() {
        let content_file = NamedTempFile::new().unwrap();
        let agent_file = NamedTempFile::new().unwrap();
        let agent_db_path = agent_file.path().to_str().unwrap();
        let content_db_path = content_file.path().to_str().unwrap();

        let content_db = Connection::open(content_db_path).unwrap();
        let agent_db = Connection::open(agent_db_path).unwrap();

        content_db.execute_batch(INITIALIZE_DATABASE_SCHEMA).unwrap();
        init_agent_db(&agent_db).unwrap();

        content_db.execute("INSERT INTO corpora (id, name) VALUES ('corp1', 'Test Corpus')", []).unwrap();
        agent_db.execute("INSERT INTO corpora (id, name) VALUES ('corp1', 'Test Corpus')", []).unwrap();
        
        agent_db.execute("INSERT INTO documents (id, corpus_id, title, sha256_hash, storage_path) VALUES ('doc1', 'corp1', 'Title', 'hash1', '/path')", []).unwrap();
        agent_db.execute("INSERT INTO processing_jobs (id, document_id, status, progress_percentage) VALUES ('job1', 'doc1', 'running', 50)", []).unwrap();
        agent_db.execute("INSERT INTO job_chunks (id, job_id, raw_text, chunk_order, status, processed_blocks) VALUES ('chunk1', 'job1', 'text', 0, 'done', 1)", []).unwrap();
        agent_db.execute("INSERT INTO tags (id, name, source) VALUES ('tag1', 'TagName', 'user')", []).unwrap();
        agent_db.execute("INSERT INTO sections (id, document_id, parent_id, title, depth_level, sort_order) VALUES ('sec1', 'doc1', NULL, 'Section', 1, 0)", []).unwrap();
        agent_db.execute("INSERT INTO blocks (id, section_id, document_id, block_type, content, sort_order) VALUES ('blk1', 'sec1', 'doc1', 'paragraph', 'Content', 0)", []).unwrap();
        agent_db.execute("INSERT INTO block_tags (block_id, tag_id) VALUES ('blk1', 'tag1')", []).unwrap();
        agent_db.execute("INSERT INTO annotations (id, document_id, note_body, highlighted_text) VALUES ('ann1', 'doc1', 'Note', 'High')", []).unwrap();
        agent_db.execute("INSERT INTO layout_height_cache (block_id, estimated_height) VALUES ('blk1', 100.5)", []).unwrap();

        migrate_agent_to_content(agent_db_path, content_db_path, "doc1").unwrap();

        // Check if data is migrated
        let job_status: String = content_db.query_row("SELECT status FROM processing_jobs WHERE id = 'job1'", [], |r| r.get(0)).unwrap();
        assert_eq!(job_status, "running");

        let chunk_status: String = content_db.query_row("SELECT status FROM job_chunks WHERE id = 'chunk1'", [], |r| r.get(0)).unwrap();
        assert_eq!(chunk_status, "done");

        let tag_name: String = content_db.query_row("SELECT name FROM tags WHERE id = 'tag1'", [], |r| r.get(0)).unwrap();
        assert_eq!(tag_name, "TagName");

        let block_tag_count: i64 = content_db.query_row("SELECT count(*) FROM block_tags WHERE block_id = 'blk1' AND tag_id = 'tag1'", [], |r| r.get(0)).unwrap();
        assert_eq!(block_tag_count, 1);

        let note_body: String = content_db.query_row("SELECT note_body FROM annotations WHERE id = 'ann1'", [], |r| r.get(0)).unwrap();
        assert_eq!(note_body, "Note");

        let height: f64 = content_db.query_row("SELECT estimated_height FROM layout_height_cache WHERE block_id = 'blk1'", [], |r| r.get(0)).unwrap();
        assert_eq!(height, 100.5);
    }
}
