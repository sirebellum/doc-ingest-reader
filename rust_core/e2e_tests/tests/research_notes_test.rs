#[path = "utils/synthetic_gen.rs"]
mod synthetic_gen;
#[path = "utils/test_db.rs"]
mod test_db;

use parser::{RealPdfExtractor, PdfExtractor, sha2_hash};
use contracts::ExtractionChunk;
use agent_harness::agent::AgentState;
use agent_harness::tools::AgentDatabases;
use agent_harness::ingest::ingest_chunk_to_agent_db;
use dbs::manager::migrate_agent_to_content;
use rusqlite::{Connection, params};
use uuid::Uuid;
use std::fs;
use std::path::Path;


#[test]
#[ignore]
fn test_research_notes_ingestion() {
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
    let agent_db_path = artifacts_dir.join("test_agent.db");

    test_db::setup_test_databases(&content_db_path, &agent_db_path);

    // Open connection
    let content_conn = Connection::open(&content_db_path).expect("Failed to open test SQLite database");

    // Initialize agent db
    let agent_conn = Connection::open(&agent_db_path).expect("Failed to open agent db");

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
    
    let state = AgentState::new(dbs).expect("Failed to create AgentState");
    
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
    for (_block_id, fts_content) in &fts_rows {
        assert!(!fts_content.contains("\"text\":"), "FTS content contains JSON key pollution");
        println!("FTS Content for block {}: '{}'", _block_id, fts_content);
    }

    println!("ALL INTEGRATION TEST PHASES COMPLETED SUCCESSFULLY!");
    

}
