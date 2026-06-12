#[path = "utils/synthetic_gen.rs"]
mod synthetic_gen;

use parser::{RealPdfExtractor, PdfExtractor, sha2_hash};
use contracts::ExtractionChunk;
use agent_harness::agent::AgentState;
use agent_harness::tools::AgentDatabases;
use agent_harness::ingest::ingest_chunk_to_agent_db;
use agent_harness::migration::migrate_agent_to_content;
use synthetic_gen::{SyntheticInput, SyntheticBlock, SyntheticSection, generate_synthetic_pdf};
use rusqlite::{Connection, params};
use uuid::Uuid;
use std::fs;
use std::path::Path;

const DDL_MIGRATION: &str = r#"
CREATE TABLE IF NOT EXISTS corpora (
    id text PRIMARY KEY NOT NULL,
    name text NOT NULL,
    description text,
    created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
    updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
    id text PRIMARY KEY NOT NULL,
    corpus_id text,
    title text NOT NULL,
    author text,
    source_type text DEFAULT 'pdf' NOT NULL,
    sha256_hash text NOT NULL,
    metadata text,
    storage_path text NOT NULL,
    created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
    updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
    FOREIGN KEY (corpus_id) REFERENCES corpora(id) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE IF NOT EXISTS sections (
    id text PRIMARY KEY NOT NULL,
    document_id text,
    parent_id text,
    title text NOT NULL,
    depth_level integer DEFAULT 1 NOT NULL,
    sort_order integer NOT NULL,
    created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (parent_id) REFERENCES sections(id) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE IF NOT EXISTS blocks (
    id text PRIMARY KEY NOT NULL,
    section_id text,
    document_id text,
    block_type text DEFAULT 'paragraph' NOT NULL,
    content text NOT NULL,
    sort_order integer NOT NULL,
    token_count integer DEFAULT 0,
    created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
    FOREIGN KEY (section_id) REFERENCES sections(id) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE IF NOT EXISTS annotations (
    id text PRIMARY KEY NOT NULL,
    document_id text,
    block_id text,
    annotation_type text DEFAULT 'highlight' NOT NULL,
    color_code text,
    highlighted_text text,
    note_body text,
    anchor_metadata text,
    author_id text,
    created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
    updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (block_id) REFERENCES blocks(id) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE IF NOT EXISTS tags (
    id text PRIMARY KEY NOT NULL,
    name text NOT NULL,
    source text NOT NULL,
    created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tags_name_unique ON tags (name);
CREATE TABLE IF NOT EXISTS block_tags (
    block_id text,
    tag_id text,
    PRIMARY KEY(block_id, tag_id),
    FOREIGN KEY (block_id) REFERENCES blocks(id) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE IF NOT EXISTS processing_jobs (
    id text PRIMARY KEY NOT NULL,
    document_id text,
    status text DEFAULT 'pending' NOT NULL,
    progress_percentage integer DEFAULT 0,
    created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
    updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE IF NOT EXISTS job_chunks (
    id text PRIMARY KEY NOT NULL,
    job_id text,
    raw_text text NOT NULL,
    chunk_order integer NOT NULL,
    status text DEFAULT 'pending' NOT NULL,
    processed_blocks text,
    FOREIGN KEY (job_id) REFERENCES processing_jobs(id) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE IF NOT EXISTS layout_height_cache (
    block_id text PRIMARY KEY NOT NULL,
    estimated_height real NOT NULL,
    FOREIGN KEY (block_id) REFERENCES blocks(id) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE IF NOT EXISTS vector_cache (
    block_id text PRIMARY KEY NOT NULL,
    vector blob NOT NULL,
    FOREIGN KEY (block_id) REFERENCES blocks(id) ON UPDATE no action ON DELETE cascade
);
CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
  block_id UNINDEXED,
  content
);

DROP TRIGGER IF EXISTS blocks_fts_ai;
CREATE TRIGGER blocks_fts_ai AFTER INSERT ON blocks BEGIN
  INSERT INTO blocks_fts(block_id, content)
  VALUES (
    new.id,
    CASE 
      WHEN json_valid(new.content) THEN (SELECT group_concat(value, ' ') FROM json_tree(new.content) WHERE key IN ('text', 'code', 'alt', 'caption'))
      ELSE new.content
    END
  );
END;

DROP TRIGGER IF EXISTS blocks_fts_ad;
CREATE TRIGGER blocks_fts_ad AFTER DELETE ON blocks BEGIN
  DELETE FROM blocks_fts WHERE block_id = old.id;
END;

DROP TRIGGER IF EXISTS blocks_fts_au;
CREATE TRIGGER blocks_fts_au AFTER UPDATE ON blocks BEGIN
  DELETE FROM blocks_fts WHERE block_id = old.id;
  INSERT INTO blocks_fts(block_id, content)
  VALUES (
    new.id,
    CASE 
      WHEN json_valid(new.content) THEN (SELECT group_concat(value, ' ') FROM json_tree(new.content) WHERE key IN ('text', 'code', 'alt', 'caption'))
      ELSE new.content
    END
  );
END;
"#;

fn setup_mock_inference() {
    let dummy_path = "dummy_model.gguf";
    if !Path::new(dummy_path).exists() {
        std::fs::File::create(dummy_path).unwrap();
    }
    let _ = inference::initialize_inference_context(dummy_path);
}

fn cleanup_mock_inference() {
    let dummy_path = "dummy_model.gguf";
    if Path::new(dummy_path).exists() {
        let _ = std::fs::remove_file(dummy_path);
    }
}

#[test]
fn test_research_notes_ingestion() {
    setup_mock_inference();

    // 1. Create target artifacts directory
    let artifacts_dir_raw = Path::new("../../test_artifacts/research_notes_test"); fs::create_dir_all(&artifacts_dir_raw).expect("Failed to create dir"); let artifacts_dir_pathbuf = artifacts_dir_raw.canonicalize().unwrap(); let artifacts_dir = artifacts_dir_pathbuf.as_path();
    
    let pdf_path_raw = Path::new("../../test_artifacts/test_inputs/notes.pdf");
    let pdf_path_buf = pdf_path_raw.canonicalize().expect("Failed to canonicalize notes.pdf path");
    let pdf_path_str = pdf_path_buf.to_str().unwrap();
    let pdf_path = pdf_path_str;
    assert!(Path::new(pdf_path).exists(), "Sample PDF not found at: {}", pdf_path);

    // ==========================================
    // PHASE 1: Static Layout Extraction
    // ==========================================
    let doc_id = format!("doc-uuid-{}", sha2_hash(pdf_path));
    let extractor = RealPdfExtractor {
        document_id: doc_id.clone(),
        pdf_path: pdf_path.to_string(),
    };

    let page_extraction = extractor.extract_page(1)
        .expect("Phase 1: PDF extraction failed");

    // Fail-fast intermediate assertions
    assert_eq!(page_extraction.page_number, 1);
    assert_eq!(page_extraction.document_id, doc_id);
    assert!(!page_extraction.raw_text.is_empty(), "Extracted text buffer is empty");
    
    let images_dir = artifacts_dir;
    let image_uris = extractor.extract_images(images_dir.to_str().unwrap())
        .expect("Phase 1: Image extraction failed");

    for uri in &image_uris {
        assert!(uri.starts_with("local-asset://"), "Image URI is not standard local-asset scheme: {}", uri);
    }

    // ==========================================
    // PHASE 2 & 3: Database Handshake & Agent Integration
    // ==========================================
    let content_db_path = artifacts_dir.join("test_corpus.db");
    if content_db_path.exists() {
        fs::remove_file(&content_db_path).unwrap();
    }
    
    let agent_db_path = artifacts_dir.join("test_agent.db");
    if agent_db_path.exists() {
        fs::remove_file(&agent_db_path).unwrap();
    }

    // Open connection
    let content_conn = Connection::open(&content_db_path).expect("Failed to open test SQLite database");
    content_conn.execute_batch(DDL_MIGRATION).expect("Failed to initialize database schema & triggers");

    // Initialize agent db
    let agent_conn = Connection::open(&agent_db_path).expect("Failed to open agent db");
    agent_harness::db::init_agent_db(&agent_conn).expect("Failed to init agent db");

    let corpus_uuid = Uuid::new_v4().to_string();
    content_conn.execute(
        "INSERT INTO corpora (id, name, description) VALUES (?, ?, ?)",
        params![corpus_uuid, "E2E Test Collection", "Integration Test Collection"],
    ).expect("Failed to insert corpus");

    content_conn.execute(
        "INSERT INTO documents (id, corpus_id, title, author, source_type, sha256_hash, storage_path) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![doc_id.clone(), corpus_uuid, "Research Notes", "Test Author", "pdf", sha2_hash(&pdf_path), pdf_path],
    ).expect("Failed to insert document");
    
    agent_conn.execute(
        "INSERT INTO corpora (id, name, description) VALUES (?, ?, ?)",
        params!["corp_1", "Test Corpus", "Desc"],
    ).expect("Failed to insert corpus");

    agent_conn.execute(
        "INSERT INTO documents (id, corpus_id, title, author, source_type, sha256_hash, storage_path) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![doc_id.clone(), "corp_1", "Test Doc", "Author", "pdf", "testhash", "/path"],
    ).expect("Failed to insert agent document");
    
    let dbs = AgentDatabases {
        agent_db: agent_conn,
        content_db: content_conn,
        agent_db_path: agent_db_path.to_string_lossy().into_owned(),
        content_db_path: content_db_path.to_string_lossy().into_owned(),
        document_id: doc_id.clone(),
    };
    
    let state = AgentState::new(dbs);
    
    let chunk = ExtractionChunk {
        document_id: doc_id.clone(),
        chunk_index: 1,
        raw_text: page_extraction.raw_text.clone(),
    };
    
    ingest_chunk_to_agent_db(&state.databases.agent_db, &chunk).expect("Failed to ingest chunk");
    
    // Simulate some mock LLM blocks by directly inserting into agent_db
    // because inference in tests with dummy model might not output proper JSON
    let sec_id = "sec-1".to_string();
    state.databases.agent_db.execute(
        "INSERT INTO sections (id, document_id, title, depth_level, sort_order) VALUES (?, ?, ?, ?, ?)",
        params![sec_id.clone(), doc_id.clone(), "Introduction", 1, 0],
    ).unwrap();
    
    state.databases.agent_db.execute(
        "INSERT INTO blocks (id, section_id, document_id, block_type, content, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
        params![uuid::Uuid::new_v4().to_string(), sec_id.clone(), doc_id.clone(), "paragraph", "This is an overview of the system architecture.", 0],
    ).unwrap();
    
    // Migrate to content db
    let _ = migrate_agent_to_content(state.databases.agent_db_path.as_str(), state.databases.content_db_path.as_str(), &doc_id);    
    let content_conn = &state.databases.content_db;
    
    // Assert 1: Automated database triggers populated plain-text blocks_fts correctly
    let mut stmt = content_conn.prepare("SELECT block_id, content FROM blocks_fts").unwrap();
    let fts_rows: Vec<(String, String)> = stmt.query_map([], |row| {
        Ok((row.get(0)?, row.get(1)?))
    }).unwrap().map(Result::unwrap).collect();

    assert!(!fts_rows.is_empty(), "FTS virtual table is empty. Triggers did not execute.");
    
    // Verify FTS trigger stripped AST formatting
    for (block_id, fts_content) in &fts_rows {
        assert!(!fts_content.contains("\"text\":"), "FTS content contains JSON key pollution ('\"text\":'): {}", fts_content);
        println!("FTS Content for block {}: '{}'", block_id, fts_content);
    }

    cleanup_mock_inference();
    println!("ALL INTEGRATION TEST PHASES COMPLETED SUCCESSFULLY!");
}
