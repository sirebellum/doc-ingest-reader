import * as SQLite from 'expo-sqlite';

export const db = SQLite.openDatabaseSync('llm_pdf_reader.db');

export const INITIALIZE_DATABASE_SCHEMA = `
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

  -- 10. Sync Triggers for FTS5 full-text indexing
  CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
    block_id UNINDEXED,
    content
  );

  -- Triggers to keep FTS5 synchronized with blocks table
  CREATE TRIGGER IF NOT EXISTS blocks_fts_ai AFTER INSERT ON blocks BEGIN
    INSERT INTO blocks_fts(block_id, content) VALUES (new.id, new.content);
  END;

  CREATE TRIGGER IF NOT EXISTS blocks_fts_ad AFTER DELETE ON blocks BEGIN
    DELETE FROM blocks_fts WHERE block_id = old.id;
  END;

  CREATE TRIGGER IF NOT EXISTS blocks_fts_au AFTER UPDATE ON blocks BEGIN
    DELETE FROM blocks_fts WHERE block_id = old.id;
    INSERT INTO blocks_fts(block_id, content) VALUES (new.id, new.content);
  END;
`;

export function setupDatabase() {
  db.execSync(INITIALIZE_DATABASE_SCHEMA);
}
