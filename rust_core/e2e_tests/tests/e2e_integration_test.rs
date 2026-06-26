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

fn mock_agent_inference(prompt: &str) -> Result<String, contracts::error::AppError> {
    if !prompt.contains("chunk_0") {
        return Ok("{\"tool\": \"read_content_db\", \"args\": {\"chunk_id\": \"chunk_0\"}}".to_string());
    }
    if prompt.contains("created_node_id") {
        return Ok("{\"tool\": \"ParsingComplete\", \"args\": {}}".to_string());
    }
    
    let mut extracted_text = String::new();
    if let Some(idx) = prompt.find("\"text\":\"") {
        let rest = &prompt[idx + 8..];
        if let Some(end) = rest.find("\"}") {
            extracted_text = rest[..end].to_string();
            extracted_text = extracted_text.replace("\\n", "\n").replace("\\\"", "\"");
        }
    }
    
    let args = serde_json::json!({
        "type": "block",
        "id": uuid::Uuid::new_v4().to_string(),
        "block_type": "p",
        "content": extracted_text
    });
    
    Ok(format!("{{\"tool\": \"CreateNode\", \"args\": {}}}", args.to_string()))
}

#[test]
fn test_e2e_ingestion_pipeline() {
    let artifacts_dir_raw = Path::new("../../test_artifacts/e2e_integration_test"); 
    fs::create_dir_all(&artifacts_dir_raw).expect("Failed to create dir"); 
    let artifacts_dir_pathbuf = artifacts_dir_raw.canonicalize().unwrap(); 
    let artifacts_dir = artifacts_dir_pathbuf.as_path();
    
    let pdfs = vec!["paper.pdf", "linked.pdf", "unlinked.pdf"];
    
    for pdf_filename in pdfs {
        let pdf_path_raw = Path::new("../../test_artifacts/test_inputs").join(pdf_filename);
        let pdf_path_buf = pdf_path_raw.canonicalize().expect(&format!("Failed to canonicalize {} path", pdf_filename));
        let pdf_path_str = pdf_path_buf.to_str().unwrap();
        let pdf_path = pdf_path_str;
        assert!(Path::new(pdf_path).exists(), "Sample PDF not found at: {}", pdf_path);

        let doc_id = format!("doc-uuid-{}-{}", pdf_filename, sha2_hash(pdf_path));
        
        let extractor = RealPdfExtractor {
            document_id: doc_id.clone(),
            pdf_path: pdf_path.to_string(),
        };

        let page_extraction = extractor.extract_page(1)
            .expect(&format!("Phase 1: PDF extraction failed for {}", pdf_filename));

        assert_eq!(page_extraction.page_number, 1);
        assert_eq!(page_extraction.document_id, doc_id);
        assert!(!page_extraction.raw_text.is_empty(), "Extracted text buffer is empty for {}", pdf_filename);
        
        let images_dir = artifacts_dir;
        let image_uris = extractor.extract_images(images_dir.to_str().unwrap())
            .expect("Phase 1: Image extraction failed");

        for uri in &image_uris {
            assert!(uri.starts_with("local-asset://"), "Image URI is not standard local-asset scheme: {}", uri);
        }

        let content_db_path = artifacts_dir.join(format!("{}_corpus.db", pdf_filename));
        let agent_db_path = artifacts_dir.join(format!("{}_agent.db", pdf_filename));

        test_db::setup_test_databases(&content_db_path, &agent_db_path);

        let content_conn = Connection::open(&content_db_path).expect("Failed to open test SQLite database");
        let agent_conn = Connection::open(&agent_db_path).expect("Failed to open agent db");

        let corpus_uuid = Uuid::new_v4().to_string();
        content_conn.execute(
            "INSERT INTO corpora (id, name, description) VALUES (?, ?, ?)",
            params![corpus_uuid.clone(), "E2E Test Collection", "Integration Test Collection"],
        ).expect("Failed to insert corpus");

        content_conn.execute(
            "INSERT INTO documents (id, corpus_id, title, author, source_type, sha256_hash, storage_path) VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![doc_id.clone(), corpus_uuid, pdf_filename, "Test Author", "pdf", sha2_hash(&pdf_path), pdf_path],
        ).expect("Failed to insert document");
        
        agent_conn.execute(
            "INSERT INTO corpora (id, name, description) VALUES (?, ?, ?)",
            params![corpus_uuid.clone(), "Test Corpus", "Desc"],
        ).expect("Failed to insert corpus");

        agent_conn.execute(
            "INSERT INTO documents (id, corpus_id, title, author, source_type, sha256_hash, storage_path) VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![doc_id.clone(), corpus_uuid.clone(), pdf_filename, "Author", "pdf", "testhash", pdf_path],
        ).expect("Failed to insert agent document");
        
        let dbs = AgentDatabases {
            agent_db: agent_conn,
            content_db: content_conn,
            agent_db_path: agent_db_path.to_string_lossy().into_owned(),
            content_db_path: content_db_path.to_string_lossy().into_owned(),
            document_id: doc_id.clone(),
        };
        
        let mut state = AgentState::new(dbs).expect("Failed to create AgentState");
        state.inference_override = Some(mock_agent_inference);
        
        state.databases.agent_db.execute("INSERT INTO processing_jobs (id, document_id, status) VALUES ('job_1', ?, 'pending')", params![doc_id.clone()]).unwrap();
        
        let text = page_extraction.raw_text.clone();
        let chunk_id = "chunk_0".to_string();
        state.databases.agent_db.execute("INSERT INTO pass1_chunks (id, document_id, raw_layout_text) VALUES (?, ?, ?)", params![chunk_id.clone(), doc_id.clone(), text]).unwrap();
        state.databases.agent_db.execute("INSERT INTO job_chunks (id, job_id, raw_text, chunk_order) VALUES (?, 'job_1', ?, ?)", params![chunk_id, text.clone(), 0]).unwrap();
        
        let chunk = ExtractionChunk {
            document_id: doc_id.clone(),
            chunk_index: 0,
            raw_text: text,
        };
        
        ingest_chunk_to_agent_db(&state.databases.agent_db, &chunk).expect("Failed to ingest chunk");
        
        // Run the actual agent loop
        loop {
            let status = state.step().unwrap();
            if status == agent_harness::agent::AgentStatus::Completed || matches!(status, agent_harness::agent::AgentStatus::WaitingForHuman(_)) {
                break;
            }
            if let agent_harness::agent::AgentStatus::Error(e) = status {
                panic!("Agent error: {}", e);
            }
        }
        
        let _ = migrate_agent_to_content(state.databases.agent_db_path.as_str(), state.databases.content_db_path.as_str(), &doc_id);    
        let content_conn = &state.databases.content_db;
        
        let mut stmt = content_conn.prepare("SELECT block_id, content FROM blocks_fts").unwrap();
        let fts_rows: Vec<(String, String)> = stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?))
        }).unwrap().map(Result::unwrap).collect();

        assert!(!fts_rows.is_empty(), "FTS virtual table is empty for {}. Agent extraction failed.", pdf_filename);
        
        for (_block_id, fts_content) in &fts_rows {
            assert!(!fts_content.contains("\"text\":"), "FTS content contains JSON key pollution ('\"text\":'): {}", fts_content);
        }
    }

    inference::teardown_inference_context();
    println!("ALL INTEGRATION TEST PHASES COMPLETED SUCCESSFULLY!");
}
