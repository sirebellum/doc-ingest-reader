pub const JSON_EXTRACT_MACRO: &str = "CASE 
  WHEN json_valid(new.content) THEN (SELECT group_concat(value, ' ') FROM json_tree(new.content) WHERE key IN ('text', 'code', 'alt', 'caption'))
  ELSE new.content
END";

pub const INITIALIZE_DATABASE_SCHEMA: &str = "
  PRAGMA foreign_keys = ON;

  -- 1. Corpora Table
  CREATE TABLE IF NOT EXISTS corpora (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  -- 2. Documents Table
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    corpus_id TEXT REFERENCES corpora(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    author TEXT,
    source_type TEXT DEFAULT 'pdf' NOT NULL,
    sha256_hash TEXT NOT NULL,
    metadata TEXT,
    storage_path TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  -- 3. Sections Table
  CREATE TABLE IF NOT EXISTS sections (
    id TEXT PRIMARY KEY,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    depth_level INTEGER DEFAULT 1 NOT NULL,
    sort_order INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  -- 4. Blocks Table
  CREATE TABLE IF NOT EXISTS blocks (
    id TEXT PRIMARY KEY,
    section_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    block_type TEXT DEFAULT 'paragraph' NOT NULL,
    content TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    token_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  -- 5. Annotations Table
  CREATE TABLE IF NOT EXISTS annotations (
    id TEXT PRIMARY KEY,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    block_id TEXT REFERENCES blocks(id) ON DELETE CASCADE,
    annotation_type TEXT DEFAULT 'highlight' NOT NULL,
    color_code TEXT,
    highlighted_text TEXT,
    note_body TEXT,
    anchor_metadata TEXT,
    author_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  -- 6. Tags Table
  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  -- 7. Block Tags Table
  CREATE TABLE IF NOT EXISTS block_tags (
    block_id TEXT REFERENCES blocks(id) ON DELETE CASCADE,
    tag_id TEXT REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (block_id, tag_id)
  );

  -- 8. Processing Jobs Table
  CREATE TABLE IF NOT EXISTS processing_jobs (
    id TEXT PRIMARY KEY,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending' NOT NULL,
    progress_percentage INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  -- 9. Job Chunks Table
  CREATE TABLE IF NOT EXISTS job_chunks (
    id TEXT PRIMARY KEY,
    job_id TEXT REFERENCES processing_jobs(id) ON DELETE CASCADE,
    raw_text TEXT NOT NULL,
    chunk_order INTEGER NOT NULL,
    status TEXT DEFAULT 'pending' NOT NULL,
    processed_blocks TEXT
  );

  -- 10. Layout Height Cache Table
  CREATE TABLE IF NOT EXISTS layout_height_cache (
    block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,
    estimated_height REAL NOT NULL
  );

  -- 11. Vector Cache Table
  CREATE TABLE IF NOT EXISTS vector_cache (
    block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,
    vector BLOB NOT NULL
  );

  -- 12. Sync Triggers for FTS5 full-text indexing
  CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
    block_id UNINDEXED,
    content
  );
";

pub fn get_sync_triggers() -> String {
    format!("
  -- Triggers to keep FTS5 synchronized with blocks table (JSON AST aware)
  CREATE TRIGGER IF NOT EXISTS blocks_fts_ai AFTER INSERT ON blocks BEGIN
    INSERT INTO blocks_fts(block_id, content)
    VALUES (
      new.id,
      {}
    );
  END;

  CREATE TRIGGER IF NOT EXISTS blocks_fts_ad AFTER DELETE ON blocks BEGIN
    DELETE FROM blocks_fts WHERE block_id = old.id;
  END;

  CREATE TRIGGER IF NOT EXISTS blocks_fts_au AFTER UPDATE ON blocks BEGIN
    DELETE FROM blocks_fts WHERE block_id = old.id;
    INSERT INTO blocks_fts(block_id, content)
    VALUES (
      new.id,
      {}
    );
  END;
", JSON_EXTRACT_MACRO, JSON_EXTRACT_MACRO)
}

pub const INITIALIZE_AGENT_DATABASE_SCHEMA: &str = "
  PRAGMA foreign_keys = ON;

  -- 1. Conversation History Table
  CREATE TABLE IF NOT EXISTS conversation_history (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  -- 2. Pass 1 Chunks Table
  CREATE TABLE IF NOT EXISTS pass1_chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    raw_layout_text TEXT NOT NULL,
    chunk_token_count INTEGER DEFAULT 0,
    overlap_buffer TEXT
  );

  -- 3. Job Queue Table
  CREATE TABLE IF NOT EXISTS job_queue (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending' NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  -- 4. Hypothesized Entities Table
  CREATE TABLE IF NOT EXISTS hypothesized_entities (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_data TEXT NOT NULL,
    confidence REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  -- 5. Scratch Vector Cache Table
  CREATE TABLE IF NOT EXISTS scratch_vector_cache (
    id TEXT PRIMARY KEY,
    vector BLOB NOT NULL,
    associated_text TEXT
  );

  -- 6. Tool Results Cache Table
  CREATE TABLE IF NOT EXISTS tool_results_cache (
    id TEXT PRIMARY KEY,
    tool_name TEXT NOT NULL,
    inputs_hash TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  -- 7. Malformed Blocks Table
  CREATE TABLE IF NOT EXISTS malformed_blocks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    raw_content TEXT NOT NULL,
    error_message TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );
";
