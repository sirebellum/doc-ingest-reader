use parser::{RealPdfExtractor, PdfExtractor, sha2_hash};
use delineator::DocumentDelineator;
use contracts::{PageExtraction, ASTNode};
use inference::downloader::ModelDownloader;
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
fn test_downloader_and_ingestion_pipeline() {
    // 1. Create target artifacts directory
    let artifacts_dir = Path::new("target/test_artifacts_e2e");
    fs::create_dir_all(artifacts_dir).expect("Failed to create test_artifacts_e2e dir");

    // ==========================================
    // PHASE 1: Downloader Resiliency Tests
    // ==========================================
    println!("[E2E Test] Starting ModelDownloader verification...");
    
    // We download a tiny public JSON file from Hugging Face for test validation
    let test_url = "https://huggingface.co/bert-base-uncased/resolve/main/config.json";
    let download_target = artifacts_dir.join("qwen_test_download.json");
    if download_target.exists() {
        let _ = fs::remove_file(&download_target);
    }

    // A. Sandbox Path Verification
    let invalid_path = Path::new("target/test_artifacts_e2e/../escape_sandbox.json");
    let sandbox_res = ModelDownloader::validate_sandbox_path(invalid_path);
    assert!(sandbox_res.is_err(), "Sandbox should prevent path traversal escaping the sandbox directory.");

    // B. Real Download and Telemetry Tracking
    let progress_called = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let progress_called_clone = progress_called.clone();
    let download_res = ModelDownloader::download_model(
        test_url,
        &download_target,
        None,
        Some(move |progress: f64| {
            progress_called_clone.store(true, std::sync::atomic::Ordering::SeqCst);
            assert!(progress >= 0.0 && progress <= 1.0, "Progress telemetry must be bounded [0.0, 1.0]");
        }),
    );

    assert!(download_res.is_ok(), "ModelDownloader failed to download: {:?}", download_res.err());
    assert!(download_target.exists(), "ModelDownloader succeeded but file was not created.");
    assert!(progress_called.load(std::sync::atomic::Ordering::SeqCst), "Telemetry progress callback was never executed.");

    // C. Expected SHA-256 Hash Check
    let actual_sha = ModelDownloader::compute_sha256(&download_target).expect("Failed to compute downloaded file hash");
    println!("[E2E Test] Computed SHA-256 for downloaded test file: {}", actual_sha);

    // Call download again with correct expected hash - should skip download instantly (we verify this does not crash)
    let skip_res = ModelDownloader::download_model(
        test_url,
        &download_target,
        Some(&actual_sha),
        None::<fn(f64)>,
    );
    assert!(skip_res.is_ok(), "Skipped download failed: {:?}", skip_res.err());

    // D. Range-Header Resume Verification
    let resume_target = artifacts_dir.join("qwen_resume_download.json");
    let resume_part = resume_target.with_extension("part");
    if resume_target.exists() {
        let _ = fs::remove_file(&resume_target);
    }
    if resume_part.exists() {
        let _ = fs::remove_file(&resume_part);
    }

    // Write a partial mock file representing interrupted download (first 5 bytes)
    fs::write(&resume_part, b"{\n  \"a").expect("Failed to write partial file");

    let resume_res = ModelDownloader::download_model(
        test_url,
        &resume_target,
        Some(&actual_sha),
        None::<fn(f64)>,
    );
    assert!(resume_res.is_ok(), "Range-header resume failed: {:?}", resume_res.err());
    assert!(resume_target.exists(), "Resumed file was not saved correctly.");
    assert!(!resume_part.exists(), "Resumed temporary .part file was not deleted upon success.");

    // E. SHA-256 Check Mismatch Rollback
    let fail_target = artifacts_dir.join("qwen_fail_download.json");
    let fail_part = fail_target.with_extension("part");
    if fail_target.exists() {
        let _ = fs::remove_file(&fail_target);
    }
    if fail_part.exists() {
        let _ = fs::remove_file(&fail_part);
    }

    let bad_sha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; // Empty hash
    let fail_res = ModelDownloader::download_model(
        test_url,
        &fail_target,
        Some(bad_sha),
        None::<fn(f64)>,
    );
    assert!(fail_res.is_err(), "Download should fail when SHA-256 hash mismatches.");
    assert!(!fail_target.exists(), "Target file should not exist after hash failure.");
    assert!(!fail_part.exists(), "Temporary .part file must be deleted (rolled back) to prevent corruption.");

    // ==========================================
    // PHASE 2: Pipeline Layout Ingestion Path
    // ==========================================
    println!("[E2E Test] Starting PDF ingestion pipeline pass verification...");
    setup_mock_inference();

    let pdf_path = "../../test_inputs/Research Notes.pdf";
    assert!(Path::new(pdf_path).exists(), "Sample PDF not found at: {}", pdf_path);

    // Pass 1: Visual Layout Extraction
    let doc_id = format!("doc-uuid-{}", sha2_hash(pdf_path));
    let extractor = RealPdfExtractor {
        document_id: doc_id.clone(),
        pdf_path: pdf_path.to_string(),
    };

    let page_extraction = extractor.extract_page(1)
        .expect("Pass 1 extraction failed");

    assert_eq!(page_extraction.page_number, 1);
    assert!(!page_extraction.raw_text.is_empty(), "Extracted text is empty");
    assert!(!page_extraction.layout_hints.is_empty(), "Layout hints were empty");

    // Pass 2: LLM Synthesis with Overlap Context Buffer Purging Validation
    // We insert a unique 100-token semantic overlap boundary context to verify it is successfully purged in the final output block
    let overlap_buffer = "OVERLAP_BOUNDARY_TOKEN_xyz_123 - Trailing overlap sentence boundary context to preserve sentence narrative flow.";
    let simulated_extraction = PageExtraction {
        document_id: doc_id.clone(),
        page_number: 1,
        overlap_context: overlap_buffer.to_string(),
        raw_text: page_extraction.raw_text.clone(),
        layout_hints: page_extraction.layout_hints.clone(),
        extracted_images: vec![],
    };

    let synthesized_extraction = DocumentDelineator::delineate_content(&simulated_extraction)
        .expect("Pass 2 delineation synthesis failed");

    // Context Purging Check: Verify the overlap_context was successfully stripped from all generated structural blocks
    for block in &synthesized_extraction.blocks {
        assert!(
            !block.content.contains("OVERLAP_BOUNDARY_TOKEN_xyz_123"),
            "Critical Failure: Overlap context buffer was not purged from final block: {}",
            block.content
        );

        // Verify content JSON is valid ASTNode
        let ast: ASTNode = serde_json::from_str(&block.content)
            .expect("Inference block content is not a structurally valid ASTNode JSON");
        
        match ast {
            ASTNode::Heading { level, .. } => {
                assert!(level > 0, "Heading level should be valid");
            }
            ASTNode::Paragraph { ref children } => {
                assert!(!children.is_empty(), "Paragraph children should not be empty");
            }
            _ => {}
        }
    }

    // ==========================================
    // PHASE 3: Database Handshake & Indexing Index
    // ==========================================
    println!("[E2E Test] Starting database SQLite commit and FTS verification...");
    let db_path = artifacts_dir.join("e2e_llm_test.db");
    if db_path.exists() {
        let _ = fs::remove_file(&db_path);
    }

    let mut conn = Connection::open(&db_path).expect("Failed to open test SQLite database");
    conn.execute_batch(DDL_MIGRATION).expect("Failed to run schema migrations and triggers");

    // Atomic SQLite transaction commit
    let tx = conn.transaction().expect("Failed to open transaction");

    let corpus_uuid = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO corpora (id, name, description) VALUES (?, ?, ?)",
        params![corpus_uuid, "E2E LLM Collection", "E2E LLM Ingestion Collection"],
    ).expect("Failed to insert corpus");

    tx.execute(
        "INSERT INTO documents (id, corpus_id, title, author, source_type, sha256_hash, storage_path) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![doc_id, corpus_uuid, "Research Notes", "Novice", "pdf", sha2_hash(pdf_path), pdf_path],
    ).expect("Failed to insert document");

    for section in &synthesized_extraction.sections {
        tx.execute(
            "INSERT INTO sections (id, document_id, parent_id, title, depth_level, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
            params![section.id, doc_id, section.parent_id, section.title, section.depth_level, section.sort_order],
        ).expect("Failed to insert section");
    }

    for block in &synthesized_extraction.blocks {
        tx.execute(
            "INSERT INTO blocks (id, section_id, document_id, block_type, content, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
            params![block.id, block.section_id, doc_id, block.block_type, block.content, block.sort_order],
        ).expect("Failed to insert block");
    }

    tx.commit().expect("Failed to commit E2E block ingestion transaction");

    // FTS Sync Verification:
    // Assert 1: Database triggers populated plain-text blocks_fts correctly
    let mut stmt = conn.prepare("SELECT block_id, content FROM blocks_fts").unwrap();
    let fts_rows: Vec<(String, String)> = stmt.query_map([], |row| {
        Ok((row.get(0)?, row.get(1)?))
    }).unwrap().map(Result::unwrap).collect();

    assert!(!fts_rows.is_empty(), "FTS virtual table is empty. Triggers did not execute.");
    
    // Assert 2: FTS index stripped AST tag formatting cleanly
    for (block_id, fts_content) in &fts_rows {
        assert!(!fts_content.contains("\"type\":"), "FTS content contains JSON key pollution in block {}: {}", block_id, fts_content);
        assert!(!fts_content.contains("\"children\":"), "FTS content contains JSON key pollution in block {}: {}", block_id, fts_content);
        assert!(!fts_content.starts_with('{'), "FTS content is raw JSON: {}", fts_content);
        println!("[E2E Test] Synced FTS content for block {}: '{}'", block_id, fts_content);
    }

    // Assert 3: Cascading relationships are intact
    let remaining_sections: i64 = conn.query_row("SELECT count(*) FROM sections WHERE document_id = ?", params![doc_id], |row| row.get(0)).unwrap();
    let remaining_blocks: i64 = conn.query_row("SELECT count(*) FROM blocks WHERE document_id = ?", params![doc_id], |row| row.get(0)).unwrap();
    
    assert!(remaining_sections > 0, "No sections in database before delete cascade");
    assert!(remaining_blocks > 0, "No blocks in database before delete cascade");

    conn.execute("DELETE FROM documents WHERE id = ?", params![doc_id]).unwrap();

    let remaining_sections_after: i64 = conn.query_row("SELECT count(*) FROM sections WHERE document_id = ?", params![doc_id], |row| row.get(0)).unwrap();
    let remaining_blocks_after: i64 = conn.query_row("SELECT count(*) FROM blocks WHERE document_id = ?", params![doc_id], |row| row.get(0)).unwrap();
    let remaining_fts_after: i64 = conn.query_row("SELECT count(*) FROM blocks_fts", [], |row| row.get(0)).unwrap();

    assert_eq!(remaining_sections_after, 0, "Sections cascading delete failed");
    assert_eq!(remaining_blocks_after, 0, "Blocks cascading delete failed");
    assert_eq!(remaining_fts_after, 0, "FTS5 cascading delete trigger failed");

    cleanup_mock_inference();
    println!("[E2E Test] ALL MODEL DOWNLOADER AND INGESTION PIPELINE ASSERTIONS PASSED!");
}
