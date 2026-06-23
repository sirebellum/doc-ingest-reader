#[path = "utils/synthetic_gen.rs"]
mod synthetic_gen;

use parser::{RealPdfExtractor, PdfExtractor};
use agent_harness::agent::AgentState;
use agent_harness::tools::AgentDatabases;
use agent_harness::ingest::ingest_chunk_to_agent_db;
use dbs::manager::migrate_agent_to_content;
use synthetic_gen::{SyntheticInput, SyntheticBlock, SyntheticSection, generate_synthetic_pdf};
use rusqlite::{Connection, params};
use uuid::Uuid;
use std::fs;
use std::path::Path;

const DDL_MIGRATION: &str = r#"
CREATE TABLE IF NOT EXISTS corpora (id text PRIMARY KEY NOT NULL, name text NOT NULL, description text, created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL, updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL);
CREATE TABLE IF NOT EXISTS documents (id text PRIMARY KEY NOT NULL, corpus_id text, title text NOT NULL, author text, source_type text DEFAULT 'pdf' NOT NULL, sha256_hash text NOT NULL, metadata text, storage_path text NOT NULL, created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL, updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL, FOREIGN KEY (corpus_id) REFERENCES corpora(id) ON UPDATE no action ON DELETE cascade);
CREATE TABLE IF NOT EXISTS sections (id text PRIMARY KEY NOT NULL, document_id text, parent_id text, title text NOT NULL, depth_level integer DEFAULT 1 NOT NULL, sort_order integer NOT NULL, created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL, FOREIGN KEY (document_id) REFERENCES documents(id) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (parent_id) REFERENCES sections(id) ON UPDATE no action ON DELETE cascade);
CREATE TABLE IF NOT EXISTS blocks (id text PRIMARY KEY NOT NULL, section_id text, document_id text, block_type text DEFAULT 'paragraph' NOT NULL, content text NOT NULL, sort_order integer NOT NULL, token_count integer DEFAULT 0, created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL, FOREIGN KEY (section_id) REFERENCES sections(id) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (document_id) REFERENCES documents(id) ON UPDATE no action ON DELETE cascade);
CREATE TABLE IF NOT EXISTS annotations (id text PRIMARY KEY NOT NULL, document_id text, block_id text, annotation_type text DEFAULT 'highlight' NOT NULL, color_code text, highlighted_text text, note_body text, anchor_metadata text, author_id text, created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL, updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL, FOREIGN KEY (document_id) REFERENCES documents(id) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (block_id) REFERENCES blocks(id) ON UPDATE no action ON DELETE cascade);
CREATE TABLE IF NOT EXISTS tags (id text PRIMARY KEY NOT NULL, name text NOT NULL, source text NOT NULL, created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS tags_name_unique ON tags (name);
CREATE TABLE IF NOT EXISTS block_tags (block_id text, tag_id text, PRIMARY KEY(block_id, tag_id), FOREIGN KEY (block_id) REFERENCES blocks(id) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (tag_id) REFERENCES tags(id) ON UPDATE no action ON DELETE cascade);
CREATE TABLE IF NOT EXISTS processing_jobs (id text PRIMARY KEY NOT NULL, document_id text, status text DEFAULT 'pending' NOT NULL, progress_percentage integer DEFAULT 0, created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL, updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL, FOREIGN KEY (document_id) REFERENCES documents(id) ON UPDATE no action ON DELETE cascade);
CREATE TABLE IF NOT EXISTS job_chunks (id text PRIMARY KEY NOT NULL, job_id text, raw_text text NOT NULL, chunk_order integer NOT NULL, status text DEFAULT 'pending' NOT NULL, processed_blocks text, FOREIGN KEY (job_id) REFERENCES processing_jobs(id) ON UPDATE no action ON DELETE cascade);
CREATE TABLE IF NOT EXISTS layout_height_cache (block_id text PRIMARY KEY NOT NULL, estimated_height real NOT NULL, FOREIGN KEY (block_id) REFERENCES blocks(id) ON UPDATE no action ON DELETE cascade);
CREATE TABLE IF NOT EXISTS vector_cache (block_id text PRIMARY KEY NOT NULL, vector blob NOT NULL, FOREIGN KEY (block_id) REFERENCES blocks(id) ON UPDATE no action ON DELETE cascade);
CREATE VIRTUAL TABLE blocks_fts USING fts5 (block_id UNINDEXED, content);
CREATE TRIGGER blocks_fts_ai AFTER INSERT ON blocks BEGIN INSERT INTO blocks_fts(block_id, content) VALUES (new.id, CASE WHEN json_valid(new.content) THEN (SELECT group_concat(value, ' ') FROM json_tree(new.content) WHERE key IN ('text', 'code', 'alt', 'caption')) ELSE new.content END); END;
CREATE TRIGGER blocks_fts_ad AFTER DELETE ON blocks BEGIN DELETE FROM blocks_fts WHERE block_id = old.id; END;
CREATE TRIGGER blocks_fts_au AFTER UPDATE ON blocks BEGIN DELETE FROM blocks_fts WHERE block_id = old.id; INSERT INTO blocks_fts(block_id, content) VALUES (new.id, CASE WHEN json_valid(new.content) THEN (SELECT group_concat(value, ' ') FROM json_tree(new.content) WHERE key IN ('text', 'code', 'alt', 'caption')) ELSE new.content END); END;
"#;

#[test]
fn test_actual_inference_pipeline() {
    if std::env::var("RUN_LLM_E2E_TESTS").is_err() {
        println!("Skipping LLM E2E test. Enable with RUN_LLM_E2E_TESTS=1");
        return;
    }

    let model_url = std::env::var("LLM_TEST_MODEL_URL").expect("LLM_TEST_MODEL_URL must be set if RUN_LLM_E2E_TESTS is 1");

    // Initialize actual inference engine
    inference::initialize_inference_context(&model_url).unwrap();

    let artifacts_dir_raw = Path::new("../../test_artifacts/pipeline_inference_test"); 
    fs::create_dir_all(&artifacts_dir_raw).expect("Failed to create dir"); 
    let artifacts_dir_pathbuf = artifacts_dir_raw.canonicalize().unwrap(); 
    let artifacts_dir = artifacts_dir_pathbuf.as_path();
    
    let content_db_path = artifacts_dir.join("test_corpus.db");
    if content_db_path.exists() { fs::remove_file(&content_db_path).unwrap(); }
    let agent_db_path = artifacts_dir.join("test_agent.db");
    if agent_db_path.exists() { fs::remove_file(&agent_db_path).unwrap(); }

    let corpus_uuid = Uuid::new_v4().to_string();
    {
        let content_conn = Connection::open(&content_db_path).unwrap();
        content_conn.execute_batch(DDL_MIGRATION).unwrap();
        content_conn.execute("INSERT INTO corpora (id, name, description) VALUES (?, ?, ?)", params![corpus_uuid.clone(), "Synthetic", "Test"]).unwrap();
    }
    {
        let agent_conn = Connection::open(&agent_db_path).unwrap();
        dbs::manager::init_agent_db(&agent_conn).unwrap();
        agent_conn.execute("INSERT INTO corpora (id, name, description) VALUES (?, ?, ?)", params!["corp_1", "Test", "Desc"]).unwrap();
    }

    let input = SyntheticInput {
        title: "Test Inference Document".to_string(),
        table_of_contents: vec![],
        strip_index_from_pdf: false,
        sections: vec![
            SyntheticSection {
                section_id: "sec-1".to_string(),
                heading: "Chapter 1: Local Inference".to_string(),
                blocks: vec![SyntheticBlock { id: "blk-1".to_string(), block_type: "p".to_string(), content: "This is a paragraph to test actual LLM extraction.".to_string() }],
            }
        ],
    };

    let pdf_path = artifacts_dir.join("test_doc.pdf");
    generate_synthetic_pdf(pdf_path.to_str().unwrap(), &input).unwrap();

    let extractor = RealPdfExtractor { document_id: "test_doc_id".to_string(), pdf_path: pdf_path.to_string_lossy().to_string() };
    let page_extraction = extractor.extract_page(1).unwrap();
    let page_extractions = vec![page_extraction];

    let doc_id = "test_doc_id";
    let sha256_hash = "dummy_hash";
    
    {
        let content_conn = Connection::open(&content_db_path).unwrap();
        content_conn.execute("INSERT INTO documents (id, corpus_id, title, author, source_type, sha256_hash, storage_path) VALUES (?, ?, ?, ?, ?, ?, ?)", 
            params![doc_id, corpus_uuid, input.title, "Author", "pdf", sha256_hash, pdf_path.to_str().unwrap()]).unwrap();
    }
    {
        let agent_conn = Connection::open(&agent_db_path).unwrap();
        agent_conn.execute("INSERT INTO documents (id, corpus_id, title, author, source_type, sha256_hash, storage_path) VALUES (?, ?, ?, ?, ?, ?, ?)", 
            params![doc_id, "corp_1", input.title, "Author", "pdf", sha256_hash, pdf_path.to_str().unwrap()]).unwrap();
    }

    let agent_conn = Connection::open(&agent_db_path).unwrap();
    let content_conn = Connection::open(&content_db_path).unwrap();
    let mut dbs = AgentDatabases {
        agent_db: agent_conn,
        content_db: content_conn,
        agent_db_path: agent_db_path.to_str().unwrap().to_string(),
        content_db_path: content_db_path.to_str().unwrap().to_string(),
        document_id: doc_id.to_string(),
    };

    let mut state = AgentState::new(dbs);
    
    // Prepare processing jobs
    state.databases.agent_db.execute("INSERT INTO processing_jobs (id, document_id, status) VALUES ('job_1', ?, 'pending')", params![doc_id]).unwrap();
    
    for (i, page) in page_extractions.into_iter().enumerate() {
        let text = page.raw_text;
        if text.trim().is_empty() { continue; }
        let chunk_id = format!("chunk_{}", i);
        state.databases.agent_db.execute("INSERT INTO pass1_chunks (id, document_id, raw_layout_text) VALUES (?, ?, ?)", params![chunk_id, doc_id, text]).unwrap();
        state.databases.agent_db.execute("INSERT INTO job_chunks (id, job_id, raw_text, chunk_order) VALUES (?, 'job_1', ?, ?)", params![chunk_id, text, i]).unwrap();
        
        let chunk = contracts::ExtractionChunk {
            document_id: doc_id.to_string(),
            chunk_index: i as u32,
            raw_text: text.to_string(),
        };
        
        // This invokes actual inference underneath!
        ingest_chunk_to_agent_db(&state.databases.agent_db, &chunk).unwrap();
    }

    // Run the agent loop until it completes or pauses
    loop {
        let status = state.step().unwrap();
        if status == agent_harness::agent::AgentStatus::Completed || matches!(status, agent_harness::agent::AgentStatus::WaitingForHuman(_)) {
            break;
        }
    }
    // Check agent DB contents BEFORE migration (since migration wipes scratch data)
    let agent_conn2 = Connection::open(&agent_db_path).unwrap();
    let malformed_count: i64 = agent_conn2.query_row("SELECT COUNT(*) FROM malformed_blocks", [], |r| r.get(0)).unwrap();
    
    migrate_agent_to_content(agent_db_path.to_str().unwrap(), content_db_path.to_str().unwrap(), doc_id).unwrap();

    let content_conn = Connection::open(&content_db_path).unwrap();
    let count: i64 = content_conn.query_row("SELECT COUNT(*) FROM blocks", [], |r| r.get(0)).unwrap();
    
    assert!(count > 0 || malformed_count > 0, "No output (valid or malformed) was produced by the actual LLM inference!");

    inference::teardown_inference_context();
}
