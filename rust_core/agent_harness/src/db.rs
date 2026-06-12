use anyhow::Result;
use rusqlite::Connection;

/// Initializes the temporary agent_db SQLite workspace using the canonical
/// Drizzle schema from the mobile frontend, then adds agent-specific ephemeral tables.
pub fn init_agent_db(db: &Connection) -> Result<()> {
    // Enable foreign keys
    db.execute("PRAGMA foreign_keys = ON;", [])?;

    // Load and execute the baseline Drizzle schema
    let drizzle_sql = include_str!("../../../mobile/drizzle/0000_fresh_newton_destine.sql");
    let statements: Vec<&str> = drizzle_sql.split("--> statement-breakpoint").collect();
    
    for stmt in statements {
        let stmt = stmt.trim();
        if !stmt.is_empty() {
            db.execute_batch(stmt)?;
        }
    }

    // Add agent-specific ephemeral tables
    db.execute(
        "CREATE TABLE IF NOT EXISTS agent_context (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL, -- 'system', 'user', 'assistant', 'tool'
            content TEXT NOT NULL,
            token_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
        )",
        [],
    )?;

    db.execute(
        "CREATE TABLE IF NOT EXISTS pass1_chunks (
            id TEXT PRIMARY KEY,
            document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
            raw_layout_text TEXT NOT NULL,
            chunk_token_count INTEGER DEFAULT 0,
            overlap_buffer TEXT
        )",
        [],
    )?;

    Ok(())
}
