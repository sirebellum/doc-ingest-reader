use anyhow::Result;
use rusqlite::Connection;

/// Initializes the temporary agent_db SQLite workspace with tables prefixed by `agent_`
/// mirroring the content_db, along with agent-specific state columns.
pub fn init_agent_db(db: &Connection) -> Result<()> {
    // Enable foreign keys
    db.execute("PRAGMA foreign_keys = ON;", [])?;

    // Create agent_documents
    db.execute(
        "CREATE TABLE IF NOT EXISTS agent_documents (
            id TEXT PRIMARY KEY,
            corpus_id TEXT,
            title TEXT NOT NULL,
            author TEXT,
            source_type TEXT DEFAULT 'pdf' NOT NULL,
            sha256_hash TEXT NOT NULL,
            metadata TEXT,
            storage_path TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
            
            -- Agent Extensions
            is_explored BOOLEAN DEFAULT 0,
            agent_scratchpad TEXT
        )",
        [],
    )?;

    // Create agent_sections
    db.execute(
        "CREATE TABLE IF NOT EXISTS agent_sections (
            id TEXT PRIMARY KEY,
            document_id TEXT REFERENCES agent_documents(id) ON DELETE CASCADE,
            parent_id TEXT REFERENCES agent_sections(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            depth_level INTEGER DEFAULT 1 NOT NULL,
            sort_order INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
            
            -- Agent Extensions
            is_explored BOOLEAN DEFAULT 0,
            agent_scratchpad TEXT,
            sequence_order INTEGER DEFAULT 0
        )",
        [],
    )?;

    // Create agent_blocks
    db.execute(
        "CREATE TABLE IF NOT EXISTS agent_blocks (
            id TEXT PRIMARY KEY,
            section_id TEXT REFERENCES agent_sections(id) ON DELETE CASCADE,
            document_id TEXT REFERENCES agent_documents(id) ON DELETE CASCADE,
            block_type TEXT DEFAULT 'paragraph' NOT NULL,
            content TEXT NOT NULL,
            sort_order INTEGER NOT NULL,
            token_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
            
            -- Agent Extensions
            is_explored BOOLEAN DEFAULT 0,
            agent_scratchpad TEXT,
            sequence_order INTEGER DEFAULT 0
        )",
        [],
    )?;

    // Create agent_tags
    db.execute(
        "CREATE TABLE IF NOT EXISTS agent_tags (
            id TEXT PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            source TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
            
            -- Agent Extensions
            is_explored BOOLEAN DEFAULT 0,
            agent_scratchpad TEXT
        )",
        [],
    )?;

    // Create agent_block_tags
    db.execute(
        "CREATE TABLE IF NOT EXISTS agent_block_tags (
            block_id TEXT REFERENCES agent_blocks(id) ON DELETE CASCADE,
            tag_id TEXT REFERENCES agent_tags(id) ON DELETE CASCADE,
            PRIMARY KEY (block_id, tag_id)
        )",
        [],
    )?;

    // Create agent_human_interactions
    db.execute(
        "CREATE TABLE IF NOT EXISTS agent_human_interactions (
            id TEXT PRIMARY KEY,
            question TEXT NOT NULL,
            context TEXT,
            status TEXT DEFAULT 'pending', -- 'pending', 'resolved'
            response TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
            resolved_at TEXT
        )",
        [],
    )?;

    // Create agent_conversation_history to store LLM's raw output and steps
    db.execute(
        "CREATE TABLE IF NOT EXISTS agent_conversation_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role TEXT NOT NULL, -- 'system', 'user', 'assistant', 'tool'
            content TEXT NOT NULL,
            timestamp TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
        )",
        [],
    )?;

    Ok(())
}
