use parser::{RealPdfExtractor, PdfExtractor, sha2_hash};
use delineator::DocumentDelineator;
use contracts::{
    PageExtraction, LayoutHint, ASTNode
};
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
fn test_e2e_ingestion_pipeline() {
    setup_mock_inference();

    // 1. Create target artifacts directory
    let artifacts_dir = Path::new("target/test_artifacts");
    fs::create_dir_all(artifacts_dir).expect("Failed to create test_artifacts dir");

    let pdf_path = "../../test_inputs/Research Notes.pdf";
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
    
    // Validate layout structure is captured
    assert!(!page_extraction.layout_hints.is_empty(), "No layout hints captured");
    let has_layout_coordinates = page_extraction.layout_hints.iter().any(|hint| {
        hint.bounding_box[2] > hint.bounding_box[0] && hint.bounding_box[3] > hint.bounding_box[1]
    });
    assert!(has_layout_coordinates, "Layout hints contain invalid or empty coordinate bounds");

    // Image extraction validation: Intercept drawings, compute SHA-256 hashes, output local-asset:// URIs
    let images_dir = artifacts_dir.join("images");
    let image_uris = extractor.extract_images(images_dir.to_str().unwrap())
        .expect("Phase 1: Image extraction failed");

    for uri in &image_uris {
        assert!(uri.starts_with("local-asset://"), "Image URI is not standard local-asset scheme: {}", uri);
        let cleaned_filename = uri.trim_start_matches("local-asset://");
        let hash_part = cleaned_filename.split('_').next().unwrap();
        assert_eq!(hash_part.len(), 64, "SHA-256 hash part length in image filename is invalid: {}", hash_part);
        
        let physical_file_path = images_dir.join(cleaned_filename);
        assert!(physical_file_path.exists(), "Sandboxed PNG file not found at: {:?}", physical_file_path);
    }

    // ==========================================
    // PHASE 2: Overlap Context & LLM Synthesis
    // ==========================================
    
    // First, verify overlap context generation: Pass N-1 context is generated in Pass 1 when page_number > 1
    // Since Research Notes.pdf has only 1 page, we simulate/test overlap context filtering explicitly
    let overlap_buffer = "This is a 100-token trailing semantic boundary buffer context from page N-1.";
    let simulated_page_extraction = PageExtraction {
        document_id: doc_id.clone(),
        page_number: 2,
        overlap_context: overlap_buffer.to_string(),
        raw_text: "Chapter 2: Synthesis. This page presents the delineator details and model execution bounds.".to_string(),
        layout_hints: vec![
            LayoutHint {
                bounding_box: [10.0, 500.0, 200.0, 520.0],
                font_size: 16.0,
                text_snippet: "Chapter 2: Synthesis".to_string(),
            }
        ],
        extracted_images: vec![],
    };

    // Pipe the extraction into the delineator (Pass 2)
    let synthesized_extraction = DocumentDelineator::delineate_content(&simulated_page_extraction)
        .expect("Phase 2: LLM delineation failed");

    // Assert that the overlap context buffer was successfully stripped/ignored in generated output blocks
    for block in &synthesized_extraction.blocks {
        assert!(!block.content.contains(overlap_buffer), 
            "Overlap context buffer was not stripped from final output block content: {}", block.content);
        
        // Assert that the inference execution layer returns structurally valid JSON AST Node structures
        let ast: ASTNode = serde_json::from_str(&block.content)
            .expect("Inference execution layer returned invalid ASTNode JSON structure");
        
        // Validate semantic markers are mapped properly
        if block.block_type == "heading" {
            match ast {
                ASTNode::Heading { level, .. } => {
                    assert!(level > 0, "Heading level must be greater than 0");
                }
                _ => panic!("Block of type 'heading' did not contain a Heading ASTNode"),
            }
        }
    }

    // Assert that sections are intelligently mapped
    assert!(!synthesized_extraction.sections.is_empty(), "Delineator failed to synthesize sections/chapters");
    assert_eq!(synthesized_extraction.sections[0].title, "Chapter 1: Local Inference");



    // ==========================================
    // PHASE 3: Database Handshake & Artifact Generation
    // ==========================================
    let db_path = artifacts_dir.join("test_corpus.db");
    if db_path.exists() {
        fs::remove_file(&db_path).unwrap();
    }

    // Open connection
    let mut conn = Connection::open(&db_path).expect("Failed to open test SQLite database");
    conn.execute_batch(DDL_MIGRATION).expect("Failed to initialize database schema & triggers");

    // Open atomic transaction and write data
    let tx = conn.transaction().expect("Failed to open write transaction");

    let corpus_uuid = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO corpora (id, name, description) VALUES (?, ?, ?)",
        params![corpus_uuid, "E2E Test Collection", "Integration Test Collection"],
    ).expect("Failed to insert corpus");

    // Load manifest.json and ingest all files in test_inputs
    let manifest_path = "../../test_inputs/manifest.json";
    let manifest_content = fs::read_to_string(manifest_path).expect("Failed to read manifest.json");
    let manifest: serde_json::Value = serde_json::from_str(&manifest_content).expect("Failed to parse manifest.json");
    let files = manifest["files"].as_array().expect("manifest files is not an array");

    for file in files {
        let filename = file["filename"].as_str().unwrap();
        let title = file["title"].as_str().unwrap();
        let author = file["author"].as_str().unwrap();
        let source_type = file["source_type"].as_str().unwrap();

        let file_path = format!("../../test_inputs/{}", filename);
        let current_doc_id = format!("doc-uuid-{}", sha2_hash(&file_path));

        tx.execute(
            "INSERT INTO documents (id, corpus_id, title, author, source_type, sha256_hash, storage_path) VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![current_doc_id, corpus_uuid, title, author, source_type, sha2_hash(&file_path), file_path],
        ).expect("Failed to insert document");

        // Insert default section to satisfy blocks foreign key constraint for non-heading blocks
        let default_section_id = format!("sec-{}-default", current_doc_id);
        tx.execute(
            "INSERT OR IGNORE INTO sections (id, document_id, parent_id, title, depth_level, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
            params![default_section_id, current_doc_id, None::<String>, "Default Section", 1, 0],
        ).expect("Failed to insert default section");

        let lopdf_doc = lopdf::Document::load(&file_path).unwrap_or_else(|_| panic!("Failed to load PDF: {}", file_path));
        let page_count = lopdf_doc.get_pages().len();

        let file_extractor = RealPdfExtractor {
            document_id: current_doc_id.clone(),
            pdf_path: file_path,
        };

        for p in 1..=page_count {
            if let Ok(page_extraction) = file_extractor.extract_page(p as u32) {
                if let Ok(synthesized) = DocumentDelineator::delineate_content(&page_extraction) {
                    for section in &synthesized.sections {
                        tx.execute(
                            "INSERT OR IGNORE INTO sections (id, document_id, parent_id, title, depth_level, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
                            params![section.id, current_doc_id, section.parent_id, section.title, section.depth_level, section.sort_order],
                        ).expect("Failed to insert section");
                    }

                    for block in &synthesized.blocks {
                        tx.execute(
                            "INSERT OR IGNORE INTO blocks (id, section_id, document_id, block_type, content, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
                            params![block.id, block.section_id, current_doc_id, block.block_type, block.content, block.sort_order],
                        ).expect("Failed to insert block");
                    }
                }
            }
        }
    }

    tx.commit().expect("Failed to commit database transaction");

    // Run fail-fast database triggers and integrity assertions
    
    // Assert 1: Automated database triggers populated plain-text blocks_fts correctly
    let mut stmt = conn.prepare("SELECT block_id, content FROM blocks_fts").unwrap();
    let fts_rows: Vec<(String, String)> = stmt.query_map([], |row| {
        Ok((row.get(0)?, row.get(1)?))
    }).unwrap().map(Result::unwrap).collect();

    assert!(!fts_rows.is_empty(), "FTS virtual table is empty. Triggers did not execute.");
    
    // Assert 2: FTS index stripped AST tag formatting cleanly
    for (block_id, fts_content) in &fts_rows {
        assert!(!fts_content.contains("\"type\":"), "FTS content contains JSON key pollution ('\"type\":'): {}", fts_content);
        assert!(!fts_content.contains("\"children\":"), "FTS content contains JSON key pollution ('\"children\":'): {}", fts_content);
        assert!(!fts_content.contains("\"text\":"), "FTS content contains JSON key pollution ('\"text\":'): {}", fts_content);
        assert!(!fts_content.starts_with('{'), "FTS content is still JSON formatted: {}", fts_content);
        println!("FTS Content for block {}: '{}'", block_id, fts_content);
    }

    // Assert 3: Cascading relationships are intact (using a dedicated cascading test document to preserve parsed test corpus)
    let cascade_doc_id = "doc-cascade-test-uuid";
    conn.execute(
        "INSERT INTO documents (id, corpus_id, title, author, source_type, sha256_hash, storage_path) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![cascade_doc_id, corpus_uuid, "Cascade Test Doc", "Test Author", "pdf", "cascade-hash-xyz", "dummy_path"],
    ).unwrap();

    let cascade_sec_id = "sec-cascade-test-uuid";
    conn.execute(
        "INSERT INTO sections (id, document_id, parent_id, title, depth_level, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
        params![cascade_sec_id, cascade_doc_id, None::<String>, "Cascade Sec Title", 1, 999],
    ).unwrap();

    let cascade_block_id = "block-cascade-test-uuid";
    conn.execute(
        "INSERT INTO blocks (id, section_id, document_id, block_type, content, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
        params![cascade_block_id, cascade_sec_id, cascade_doc_id, "paragraph", "Cascade Block Content", 999],
    ).unwrap();

    // Verify FTS trigger inserted Cascade block
    let fts_before_delete: i64 = conn.query_row("SELECT count(*) FROM blocks_fts WHERE block_id = ?", params![cascade_block_id], |row| row.get(0)).unwrap();
    assert_eq!(fts_before_delete, 1, "FTS block insertion failed for cascade check");

    // Perform cascade delete
    conn.execute("DELETE FROM documents WHERE id = ?", params![cascade_doc_id]).unwrap();
    
    // After delete, blocks and sections of the cascade document must be automatically deleted by cascade triggers
    let remaining_sections: i64 = conn.query_row("SELECT count(*) FROM sections WHERE document_id = ?", params![cascade_doc_id], |row| row.get(0)).unwrap();
    let remaining_blocks: i64 = conn.query_row("SELECT count(*) FROM blocks WHERE document_id = ?", params![cascade_doc_id], |row| row.get(0)).unwrap();
    let remaining_fts: i64 = conn.query_row("SELECT count(*) FROM blocks_fts WHERE block_id = ?", params![cascade_block_id], |row| row.get(0)).unwrap();

    assert_eq!(remaining_sections, 0, "Sections cascading delete failed");
    assert_eq!(remaining_blocks, 0, "Blocks cascading delete failed");
    assert_eq!(remaining_fts, 0, "FTS5 cascading delete trigger failed");

    cleanup_mock_inference();
    println!("ALL INTEGRATION TEST PHASES COMPLETED SUCCESSFULLY!");
}
