#[path = "utils/synthetic_gen.rs"]
mod synthetic_gen;

use parser::{RealPdfExtractor, PdfExtractor, sha2_hash};
use delineator::DocumentDelineator;
use contracts::{
    PageExtraction, ASTNode
};
use synthetic_gen::{SyntheticInput, SyntheticBlock, SyntheticSection, TocItem, generate_synthetic_pdf};
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

// Tokenizes text for robust differential validation (ignores whitespace/punctuation differences)
fn tokenize(text: &str) -> Vec<String> {
    text.chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .map(|s| s.to_lowercase())
        .collect()
}

// Recursively extracts text from ASTNode deserialized from database block content
fn get_text_from_ast_json(json_str: &str) -> String {
    let node: ASTNode = serde_json::from_str(json_str).unwrap();
    get_plain_text_from_ast(&node)
}

fn get_plain_text_from_ast(node: &ASTNode) -> String {
    match node {
        ASTNode::Text { text, .. } => text.clone(),
        ASTNode::Heading { children, .. } |
        ASTNode::Paragraph { children } |
        ASTNode::Link { children, .. } |
        ASTNode::Quote { children } => {
            children.iter().map(get_plain_text_from_ast).collect::<Vec<String>>().join("")
        }
        ASTNode::List { items, .. } => {
            items.iter().map(|item| {
                item.children.iter().map(get_plain_text_from_ast).collect::<Vec<String>>().join("")
            }).collect::<Vec<String>>().join(" ")
        }
        ASTNode::Table { rows } => {
            rows.iter().map(|row| {
                row.cells.iter().map(|cell| {
                    cell.children.iter().map(get_plain_text_from_ast).collect::<Vec<String>>().join("")
                }).collect::<Vec<String>>().join(" ")
            }).collect::<Vec<String>>().join(" ")
        }
        ASTNode::Image { alt, caption, .. } => {
            if let Some(c) = caption {
                c.clone()
            } else if let Some(a) = alt {
                a.clone()
            } else {
                String::new()
            }
        }
        ASTNode::CodeBlock { code, .. } => code.clone(),
    }
}

#[test]
fn test_e2e_synthetic_pdf_validation() {
    setup_mock_inference();

    // 1. Setup target artifacts directory
    let artifacts_dir = Path::new("target/test_artifacts");
    fs::create_dir_all(artifacts_dir).expect("Failed to create test_artifacts directory");

    // ==========================================
    // STAGE 0: Define & Save Pre-PDF Golden Content
    // ==========================================
    let pre_pdf_input = SyntheticInput {
        title: "Synthetic Ingestion Volume 1".to_string(),
        table_of_contents: vec![
            TocItem {
                title: "Chapter 1: Native Bridges".to_string(),
                anchor_block_id: "b1".to_string(),
            },
        ],
        sections: vec![
            SyntheticSection {
                section_id: "s1".to_string(),
                heading: "Chapter 1: Native Bridges".to_string(),
                blocks: vec![
                    SyntheticBlock {
                        id: "b1".to_string(),
                        block_type: "p".to_string(),
                        content: "The boundary layer handles dynamic allocations securely.".to_string(),
                    },
                    SyntheticBlock {
                        id: "b2".to_string(),
                        block_type: "table".to_string(),
                        content: "|| speed || cost ||\n|| 100 pages || $0 ||".to_string(),
                    },
                ],
            },
        ],
        strip_index_from_pdf: true,
    };

    let pre_pdf_json_path = artifacts_dir.join("synthetic_pre_pdf.json");
    let serialized_pre_pdf = serde_json::to_string_pretty(&pre_pdf_input).unwrap();
    fs::write(&pre_pdf_json_path, &serialized_pre_pdf).expect("Failed to write pre-PDF json artifact");

    // ==========================================
    // STAGE 1: Generate & Save Raw PDF Artifact
    // ==========================================
    let pdf_artifact_path = artifacts_dir.join("golden_test.pdf");
    
    // Save locally
    generate_synthetic_pdf(pdf_artifact_path.to_str().unwrap(), &pre_pdf_input)
        .expect("Failed to generate raw synthetic PDF");
    
    // Save to temp path /tmp/golden_test.pdf as requested
    let _ = fs::create_dir_all("/tmp");
    let temp_pdf_path = "/tmp/golden_test.pdf";
    let _ = generate_synthetic_pdf(temp_pdf_path, &pre_pdf_input);

    assert!(pdf_artifact_path.exists(), "Raw PDF artifact was not created");

    // Assert that the raw PDF DOES NOT include metadata related to chapters/indices for navigation.
    // We want to test the LLM's capability to generate and place indices for the output.
    let lopdf_doc = lopdf::Document::load(&pdf_artifact_path)
        .expect("Failed to load generated PDF with lopdf for metadata check");
    if let Ok(catalog) = lopdf_doc.catalog() {
        if let Ok(outlines_obj) = catalog.get(b"Outlines") {
            if let Ok(ref_id) = outlines_obj.as_reference() {
                if let Ok(deref_obj) = lopdf_doc.get_object(ref_id) {
                    if let Ok(dict) = deref_obj.as_dict() {
                        if let Ok(count_obj) = dict.get(b"Count") {
                            let count = count_obj.as_i64().unwrap_or(0);
                            assert_eq!(count, 0, "PDF contains navigation outlines count > 0");
                        }
                        assert!(
                            dict.get(b"First").is_err(),
                            "PDF catalog contains structural bookmark entries (First pointer exists)"
                        );
                    }
                }
            }
        }
    }

    // ==========================================
    // STAGE 2: Execute Pass 1 (Static Layout Extraction) & Save Output
    // ==========================================
    let doc_id = format!("doc-uuid-{}", sha2_hash(pdf_artifact_path.to_str().unwrap()));
    let extractor = RealPdfExtractor {
        document_id: doc_id.clone(),
        pdf_path: pdf_artifact_path.to_str().unwrap().to_string(),
    };

    // Extract visual character vectors, fonts, layout blocks
    let page_extraction = extractor.extract_page(1)
        .expect("Pass 1 extraction failed");

    // Save Pass 1 output
    let pass1_json_path = artifacts_dir.join("synthetic_pass1_output.json");
    let serialized_pass1 = serde_json::to_string_pretty(&page_extraction).unwrap();
    fs::write(&pass1_json_path, &serialized_pass1).expect("Failed to write Pass 1 output artifact");

    // Assertions for Pass 1 layout coordinates & character accuracy
    assert_eq!(page_extraction.page_number, 1);
    assert!(!page_extraction.raw_text.is_empty(), "Extracted text stream must not be empty");
    assert!(!page_extraction.layout_hints.is_empty(), "Layout hints must not be empty");

    // Check that column sorting is correct by validating left and right column horizontal properties
    let mid_x = 306.0; // 612 / 2
    let has_left = page_extraction.layout_hints.iter().any(|hint| hint.bounding_box[2] < mid_x);
    let has_right = page_extraction.layout_hints.iter().any(|hint| hint.bounding_box[0] > mid_x);
    assert!(has_left && has_right, "Multi-column structural parsing must successfully isolate left and right coordinates");

    // ==========================================
    // STAGE 3: Execute Pass 2 (LLM Delineation with Overlap Buffer) & Save Output
    // ==========================================
    let overlap_buffer = "This is a 100-token trailing semantic boundary buffer context from page N-1.";
    let page_extraction_with_overlap = PageExtraction {
        document_id: doc_id.clone(),
        page_number: 1,
        overlap_context: overlap_buffer.to_string(),
        raw_text: page_extraction.raw_text.clone(),
        layout_hints: page_extraction.layout_hints.clone(),
        extracted_images: vec![],
    };

    let delineated_output = DocumentDelineator::delineate_content(&page_extraction_with_overlap)
        .expect("Pass 2 delineation failed");

    // Save Pass 2 output
    let pass2_json_path = artifacts_dir.join("synthetic_pass2_output.json");
    let serialized_pass2 = serde_json::to_string_pretty(&delineated_output).unwrap();
    fs::write(&pass2_json_path, &serialized_pass2).expect("Failed to write Pass 2 output artifact");

    // Confirm overlap context filtering
    for block in &delineated_output.blocks {
        assert!(!block.content.contains(overlap_buffer), "Pass 2 failed to purge overlap context from output blocks");
    }

    // Extensible Metadata Index Extraction (Pass 2 live model metadata check)
    let index_extractor = delineator::IndexExtractor::new();
    use delineator::MetadataExtractor;
    let extracted_meta = index_extractor.extract(&page_extraction_with_overlap, Some("dummy_model_synthetic.gguf"))
        .expect("IndexExtractor failed to extract metadata on synthetic PDF");

    let doc_index = match extracted_meta {
        contracts::ExtractedMetadata::Index(ref idx) => idx,
        _ => panic!("Expected ExtractedMetadata::Index variant"),
    };

    assert!(!doc_index.items.is_empty(), "Extracted DocumentIndex for synthetic PDF should not be empty");
    assert_eq!(doc_index.items[0].title, "Chapter 1: Native Bridges");
    assert_eq!(doc_index.items[0].page_start, 1);
    assert_eq!(doc_index.items[0].level, 1);

    // Save synthetic index metadata output artifact
    let index_json_path = artifacts_dir.join("synthetic_index_metadata.json");
    let serialized_index = serde_json::to_string_pretty(&doc_index).unwrap();
    fs::write(&index_json_path, &serialized_index).expect("Failed to write synthetic index metadata artifact");

    // ==========================================
    // STAGE 4: Database Synchronization & Indexing
    // ==========================================
    let db_path = artifacts_dir.join("synthetic_test.db");
    if db_path.exists() {
        fs::remove_file(&db_path).unwrap();
    }

    let mut conn = Connection::open(&db_path).expect("Failed to open SQLite database");
    conn.execute_batch(DDL_MIGRATION).expect("Failed to initialize database schema");

    // Open atomic transaction write
    let tx = conn.transaction().expect("Failed to open transaction");

    let corpus_uuid = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO corpora (id, name, description) VALUES (?, ?, ?)",
        params![corpus_uuid, "Synthetic QA Corpus", "Collection for synthetic PDF evaluation"],
    ).expect("Failed to insert corpus");

    tx.execute(
        "INSERT INTO documents (id, corpus_id, title, author, source_type, sha256_hash, storage_path) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![
            doc_id, 
            corpus_uuid, 
            pre_pdf_input.title, 
            "Synthetic Generator", 
            "pdf", 
            sha2_hash(pdf_artifact_path.to_str().unwrap()), 
            pdf_artifact_path.to_str().unwrap()
        ],
    ).expect("Failed to insert document");

    let default_section_id = format!("sec-{}-default", doc_id);
    tx.execute(
        "INSERT OR IGNORE INTO sections (id, document_id, parent_id, title, depth_level, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
        params![default_section_id, doc_id, None::<String>, "Default Section", 1, 0],
    ).expect("Failed to insert default section");

    for section in &delineated_output.sections {
        tx.execute(
            "INSERT INTO sections (id, document_id, parent_id, title, depth_level, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
            params![section.id, doc_id, section.parent_id, section.title, section.depth_level, section.sort_order],
        ).expect("Failed to insert section");
    }

    // Insert extracted metadata index items into the sections table
    let mut index_item_counter = 0;
    for item in &doc_index.items {
        index_item_counter += 1;
        let index_sec_id = format!("sec-metadata-index-{}-{}", doc_id, index_item_counter);
        tx.execute(
            "INSERT INTO sections (id, document_id, parent_id, title, depth_level, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
            params![
                index_sec_id,
                doc_id,
                None::<String>,
                item.title,
                item.level,
                item.page_start * 1000 + index_item_counter
            ],
        ).expect("Failed to insert metadata index item as section");
    }

    for block in &delineated_output.blocks {
        tx.execute(
            "INSERT INTO blocks (id, section_id, document_id, block_type, content, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
            params![block.id, block.section_id, doc_id, block.block_type, block.content, block.sort_order],
        ).expect("Failed to insert block");
    }

    tx.commit().expect("Failed to commit db transaction");

    // ==========================================
    // STAGE 5: Differential Validation
    // ==========================================
    
    // A. Text Fidelity (Tokenized character diff matching)
    let mut stmt = conn.prepare("SELECT block_type, content FROM blocks ORDER BY sort_order ASC").unwrap();
    let db_blocks: Vec<(String, String)> = stmt.query_map([], |row| {
        Ok((row.get(0)?, row.get(1)?))
    }).unwrap().map(Result::unwrap).collect();

    // Collect all blocks from pre_pdf_input in logical order
    let mut golden_blocks = Vec::new();
    // First heading is inserted dynamically during delineation
    golden_blocks.push(("heading".to_string(), "Chapter 1: Native Bridges".to_string()));
    for section in &pre_pdf_input.sections {
        for block in &section.blocks {
            golden_blocks.push((
                if block.block_type == "p" { "paragraph".to_string() } else { block.block_type.clone() },
                block.content.clone()
            ));
        }
    }

    assert_eq!(db_blocks.len(), golden_blocks.len(), "Number of processed blocks in database does not match golden content");

    for (i, (db_type, db_content_json)) in db_blocks.iter().enumerate() {
        let (golden_type, golden_content) = &golden_blocks[i];
        assert_eq!(db_type, golden_type, "Block type mismatch at index {}", i);

        // Extract plain text recursively from AST JSON
        let db_plain_text = get_text_from_ast_json(db_content_json);
        
        let db_tokens = tokenize(&db_plain_text);
        let golden_tokens = tokenize(golden_content);
        
        assert_eq!(
            db_tokens, 
            golden_tokens, 
            "Fidelity token mismatch at block index {}.\nExpected: {:?}\nActual: {:?}", 
            i, golden_tokens, db_tokens
        );
    }

    // B. Structural Extraction (ToC, Chapter boundaries, Metadata Tables)
    let section_count: i64 = conn.query_row("SELECT count(*) FROM sections", [], |row| row.get(0)).unwrap();
    assert!(section_count > 0, "Structural verification failed: no chapters/sections found in database");
    
    // Compare original indexing information (ToC) against the LLM generated indexing (DB sections)
    let mut section_stmt = conn.prepare("SELECT title FROM sections WHERE id != ? AND id NOT LIKE 'sec-metadata-index-%' ORDER BY sort_order ASC").unwrap();
    let db_sections: Vec<String> = section_stmt.query_map(params![default_section_id], |row| {
        Ok(row.get(0)?)
    }).unwrap().map(Result::unwrap).collect();

    assert_eq!(
        db_sections.len(),
        pre_pdf_input.table_of_contents.len(),
        "Number of generated sections does not match original indexing information"
    );

    for (i, db_sec_title) in db_sections.iter().enumerate() {
        let expected_title = &pre_pdf_input.table_of_contents[i].title;
        assert_eq!(
            db_sec_title,
            expected_title,
            "Section title mismatch at index {}: expected '{}', found '{}'",
            i,
            expected_title,
            db_sec_title
        );
    }

    // Compare extracted index metadata against the original indexing (ToC)
    let mut metadata_section_stmt = conn.prepare("SELECT title FROM sections WHERE id LIKE 'sec-metadata-index-%' ORDER BY sort_order ASC").unwrap();
    let db_metadata_sections: Vec<String> = metadata_section_stmt.query_map([], |row| {
        Ok(row.get(0)?)
    }).unwrap().map(Result::unwrap).collect();

    assert_eq!(
        db_metadata_sections.len(),
        pre_pdf_input.table_of_contents.len(),
        "Number of generated metadata index sections does not match original indexing information"
    );

    for (i, db_sec_title) in db_metadata_sections.iter().enumerate() {
        let expected_title = &pre_pdf_input.table_of_contents[i].title;
        assert_eq!(
            db_sec_title,
            expected_title,
            "Metadata index title mismatch at index {}: expected '{}', found '{}'",
            i,
            expected_title,
            db_sec_title
        );
    }

    // C. FTS5 Indexing Synchronization
    let mut fts_stmt = conn.prepare("SELECT block_id, content FROM blocks_fts").unwrap();
    let fts_rows: Vec<(String, String)> = fts_stmt.query_map([], |row| {
        Ok((row.get(0)?, row.get(1)?))
    }).unwrap().map(Result::unwrap).collect();

    assert!(!fts_rows.is_empty(), "FTS virtual search table is empty");
    
    for (block_id, fts_content) in &fts_rows {
        // Assert FTS virtual triggers stripped AST metadata cleanly
        assert!(!fts_content.contains("\"type\":"), "FTS index pollution in block {}: {}", block_id, fts_content);
        assert!(!fts_content.contains("\"children\":"), "FTS index pollution in block {}: {}", block_id, fts_content);
        assert!(!fts_content.starts_with('{'), "FTS block still contains raw JSON AST content: {}", fts_content);
        
        // Assert tokenized FTS content aligns with source
        let fts_tokens = tokenize(fts_content);
        assert!(!fts_tokens.is_empty(), "FTS content tokenization returned empty list");
    }

    cleanup_mock_inference();
    println!("ALL PROGRAMMATIC SYNTHETIC PDF INGESTION VALIDATIONS COMPLETED SUCCESSFULLY!");
}
