#[path = "utils/synthetic_gen.rs"]
mod synthetic_gen;

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
    if let Ok(model_url) = std::env::var("LLM_TEST_MODEL_URL") {
        let _ = inference::initialize_inference_context(&model_url);
        return;
    }
    let dummy_path = "dummy_model.gguf";
    if !Path::new(dummy_path).exists() {
        std::fs::File::create(dummy_path).unwrap();
    }
    let _ = inference::initialize_inference_context(dummy_path);
}

fn cleanup_mock_inference() {
    inference::teardown_inference_context();
    let dummy_path = "dummy_model.gguf";
    if Path::new(dummy_path).exists() {
        let _ = std::fs::remove_file(dummy_path);
    }
}

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
        if content_db_path.exists() { fs::remove_file(&content_db_path).unwrap(); }
        
        let agent_db_path = artifacts_dir.join(format!("{}_agent.db", pdf_filename));
        if agent_db_path.exists() { fs::remove_file(&agent_db_path).unwrap(); }

        let content_conn = Connection::open(&content_db_path).expect("Failed to open test SQLite database");
        content_conn.execute_batch(DDL_MIGRATION).expect("Failed to initialize database schema & triggers");

        let agent_conn = Connection::open(&agent_db_path).expect("Failed to open agent db");
        dbs::manager::init_agent_db(&agent_conn).expect("Failed to init agent db");

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
            params!["corp_1", "Test Corpus", "Desc"],
        ).expect("Failed to insert corpus");

        agent_conn.execute(
            "INSERT INTO documents (id, corpus_id, title, author, source_type, sha256_hash, storage_path) VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![doc_id.clone(), "corp_1", pdf_filename, "Author", "pdf", "testhash", pdf_path],
        ).expect("Failed to insert agent document");
        
        let dbs = AgentDatabases {
            agent_db: agent_conn,
            content_db: content_conn,
            agent_db_path: agent_db_path.to_string_lossy().into_owned(),
            content_db_path: content_db_path.to_string_lossy().into_owned(),
            document_id: doc_id.clone(),
        };
        
        let mut state = AgentState::new(dbs);
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
