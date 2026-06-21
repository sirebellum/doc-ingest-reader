#[path = "utils/synthetic_gen.rs"]
mod synthetic_gen;

use parser::{RealPdfExtractor, PdfExtractor, sha2_hash};
use contracts::ExtractionChunk;
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
#[ignore]
fn test_e2e_synthetic_validation() {
    setup_mock_inference();

    let artifacts_dir_raw = Path::new("../../test_artifacts/e2e_synthetic_validation"); 
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

    let inputs = vec![
        SyntheticInput {
            title: "Doc 1 Simple".to_string(),
            table_of_contents: vec![],
            strip_index_from_pdf: false,
            sections: vec![
                SyntheticSection {
                    section_id: "sec-1".to_string(),
                    heading: "Chapter 1: Intro".to_string(),
                    blocks: vec![SyntheticBlock { id: "blk-1".to_string(), block_type: "p".to_string(), content: "Simple paragraph".to_string() }],
                }
            ],
        },
        SyntheticInput {
            title: "Doc 2 Complex".to_string(),
            table_of_contents: vec![],
            strip_index_from_pdf: false,
            sections: vec![
                SyntheticSection {
                    section_id: "sec-1".to_string(),
                    heading: "Chapter 1: Complex".to_string(),
                    blocks: vec![
                        SyntheticBlock { id: "blk-1".to_string(), block_type: "p".to_string(), content: "First part".to_string() },
                        SyntheticBlock { id: "blk-2".to_string(), block_type: "p".to_string(), content: "Second part".to_string() },
                    ],
                },
                SyntheticSection {
                    section_id: "sec-2".to_string(),
                    heading: "Chapter 2: More".to_string(),
                    blocks: vec![SyntheticBlock { id: "blk-3".to_string(), block_type: "p".to_string(), content: "More text".to_string() }],
                }
            ],
        },
        SyntheticInput {
            title: "Doc 3 Table".to_string(),
            table_of_contents: vec![],
            strip_index_from_pdf: false,
            sections: vec![
                SyntheticSection {
                    section_id: "sec-1".to_string(),
                    heading: "Chapter 1: Tables".to_string(),
                    blocks: vec![SyntheticBlock { id: "blk-1".to_string(), block_type: "table".to_string(), content: "".to_string() }],
                }
            ],
        },
        SyntheticInput {
            title: "Doc 4 TOC".to_string(),
            table_of_contents: vec![synthetic_gen::TocItem { title: "Ch1".to_string(), anchor_block_id: "blk-1".to_string() }],
            strip_index_from_pdf: false,
            sections: vec![
                SyntheticSection {
                    section_id: "sec-1".to_string(),
                    heading: "Chapter 1: With TOC".to_string(),
                    blocks: vec![SyntheticBlock { id: "blk-1".to_string(), block_type: "p".to_string(), content: "TOC text".to_string() }],
                }
            ],
        },
        SyntheticInput {
            title: "Doc 5 Stripped".to_string(),
            table_of_contents: vec![synthetic_gen::TocItem { title: "Ch1".to_string(), anchor_block_id: "blk-1".to_string() }],
            strip_index_from_pdf: true,
            sections: vec![
                SyntheticSection {
                    section_id: "sec-1".to_string(),
                    heading: "Chapter 1: Stripped".to_string(),
                    blocks: vec![SyntheticBlock { id: "blk-1".to_string(), block_type: "p".to_string(), content: "Stripped text".to_string() }],
                }
            ],
        },
    ];

    for (i, input) in inputs.iter().enumerate() {
        let safe_title = input.title.replace(" ", "_");
        let json_path = artifacts_dir.join(format!("{}.json", safe_title));
        fs::write(&json_path, serde_json::to_string_pretty(input).unwrap()).unwrap();

        let pdf_path_buf = artifacts_dir.join(format!("{}.pdf", safe_title)); 
        let pdf_path_str = pdf_path_buf.to_str().unwrap();
        
        generate_synthetic_pdf(pdf_path_str, input).expect("Failed to generate PDF");

        let doc_id = format!("doc-uuid-{}-{}", i, sha2_hash(pdf_path_str));
        // let _pdfium = ... 
        let extractor = RealPdfExtractor { document_id: doc_id.clone(), pdf_path: pdf_path_str.to_string() };
        let page_extraction = extractor.extract_page(1).unwrap();
        
        let content_conn = Connection::open(&content_db_path).unwrap();
        let agent_conn = Connection::open(&agent_db_path).unwrap();

        content_conn.execute(
            "INSERT INTO documents (id, corpus_id, title, author, source_type, sha256_hash, storage_path) VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![doc_id.clone(), corpus_uuid.clone(), input.title, "Author", "pdf", sha2_hash(pdf_path_str), pdf_path_str],
        ).unwrap();
        
        agent_conn.execute(
            "INSERT INTO documents (id, corpus_id, title, author, source_type, sha256_hash, storage_path) VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![doc_id.clone(), "corp_1", input.title, "Author", "pdf", "testhash", pdf_path_str],
        ).unwrap();

        let dbs = AgentDatabases {
            agent_db: agent_conn,
            content_db: content_conn,
            agent_db_path: agent_db_path.to_string_lossy().into_owned(),
            content_db_path: content_db_path.to_string_lossy().into_owned(),
            document_id: doc_id.clone(),
        };
        
        let state = AgentState::new(dbs);
        let chunk = ExtractionChunk { document_id: doc_id.clone(), chunk_index: 1, raw_text: page_extraction.raw_text.clone() };
        ingest_chunk_to_agent_db(&state.databases.agent_db, &chunk).unwrap();
        
        let mut sort_order = 0;
        for section in &input.sections {
            let sec_id = format!("{}-{}", doc_id, section.section_id);
            state.databases.agent_db.execute(
                "INSERT INTO sections (id, document_id, title, depth_level, sort_order) VALUES (?, ?, ?, ?, ?)",
                params![sec_id.clone(), doc_id.clone(), section.heading.clone(), 1, sort_order],
            ).unwrap();
            
            for block in &section.blocks {
                let block_id = format!("{}-{}", doc_id, block.id);
                state.databases.agent_db.execute(
                    "INSERT INTO blocks (id, section_id, document_id, block_type, content, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
                    params![block_id, sec_id.clone(), doc_id.clone(), block.block_type.clone(), block.content.clone(), sort_order],
                ).unwrap();
                sort_order += 1;
            }
        }
        
        migrate_agent_to_content(state.databases.agent_db_path.as_str(), state.databases.content_db_path.as_str(), &doc_id).unwrap();    

        // Query the DB output to assert it matches the original JSON structures
        let mut stmt = state.databases.content_db.prepare("SELECT content FROM blocks WHERE document_id = ? ORDER BY sort_order").unwrap();
        let db_blocks: Vec<String> = stmt.query_map(params![doc_id], |row| row.get(0)).unwrap().map(Result::unwrap).collect();
        
        let expected_blocks: Vec<String> = input.sections.iter().flat_map(|s| s.blocks.iter().map(|b| b.content.clone())).collect();
        assert_eq!(db_blocks, expected_blocks, "Database output does not match original JSON structures for doc {}", input.title);
    }

    let content_conn = Connection::open(&content_db_path).unwrap();
    let mut stmt = content_conn.prepare("SELECT block_id, content FROM blocks_fts").unwrap();
    let fts_rows: Vec<(String, String)> = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?))).unwrap().map(Result::unwrap).collect();
    assert!(!fts_rows.is_empty(), "FTS virtual table is empty.");
    for (block_id, fts_content) in &fts_rows {
        assert!(!fts_content.contains("\"text\":"), "FTS content contains JSON key pollution");
    }

    cleanup_mock_inference();
    println!("ALL INTEGRATION TEST PHASES COMPLETED SUCCESSFULLY!");
}
