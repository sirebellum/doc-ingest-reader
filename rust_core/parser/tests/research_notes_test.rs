use parser::{RealPdfExtractor, PdfExtractor, sha2_hash};
use delineator::DocumentDelineator;
use contracts::ASTNode;
use rusqlite::{Connection, params};
use uuid::Uuid;
use std::fs;
use std::path::Path;

const GROUND_TRUTH: &str = r#"Year 1964, Third Epoch
All I’ve researched, everything I’ve accomplished, my entire life has
led to this. This one discovery has the potential to lift me from a
simple novice at the Arcanum to my rightful place among the upper
echelons of academic society. Beyond them, even. My name shall be
recorded alongside the legends of history, should my hypotheses be
correct. I mustn’t forget my origins, however, as it was through my
humble beginnings that the path towards my destiny was revealed.
I was raised in a small, northern village, a self-taught arcanist. I
grew up listening to the ridiculous folktales of my people. Stories of
heroes and high lords battling the foulest of abominations. With the
truth of these tales, surely lost to time, they were of little interest to
me. In fact, feeling as though my talent was being wasted
surrounded by inferior minds, I soon left my village and traveled to
the Praxium Arcanum to further my education in the arcane arts.
However, once again my potential was stifled. I, of course, easily
passed the entrance examination but as an initiate I was given
menial tasks. For months, I toiled, wiping tables, sweeping
laboratories, discarding outdated tomes… It was amidst this
drudgery that I came across the catalyst of my expedition.
I was preparing the research journals of the disgraced Professor
Laclérmont for incineration, following his recent expulsion from the
Arcanum, when one fell off the stack. I bent to retrieve it off the
ground but stopped when I realized I recognized the map that was
sketched on the page the book had flipped open to. It was a map of
an area not far from my village. On a whim, I briefly skimmed the
research documentation to discover Laclérmont had been
investigating an ancient relic, one of unparalleled potency.
Professor Laclérmont was known for his interest in ancient artifacts
and the power they may still hold, but in his own words “the subject
of this query is leagues above all other archaeological findings in
the last three centuries, regarding its potential impact on our
understanding of magic and the whole of Verdara”.
Laclérmont had collected a vast array of stories and legends, many
of which I was familiar with from my childhood, that contained
any mention of a relic known broadly as the Vaelith Reliquary. This
object was thought to be able to trap and hold the soul of a god, or
at least a portion of it. Further, using his knowledge of transference
runes, Laclérmont had theorized a method of binding a fragment
of Mylaris, the Aether that created the Runic Mythros itself, to this
Vaelith Reliquary and using it to completely uncap the wielder's
magical capacity. What Laclérmont proposed was a viable path to
limitless power!
The only obstacle Laclérmont faced was an unfamiliarity to the
area where the Reliquary was said to be hidden, an obstacle that
does not impede me. Following a trivial geographical study of the
mountainous region surrounding my old village, I believe I have
identified the exact location of the Reliquary.
Laclérmont’s notes became frantic near the end. He spoke of a final
barrier that guards the Reliquary. He claimed that the keepers of
the relic do not lock their gates with metal, but with the 'reflections
of the those who wish to enter.' I suspect this is merely poetic
metaphor, but I must remain vigilant for any illusions on my
search.
My petition for a sabbatical to return to my village has already been
approved. I am not blind to the possibility that the relic I seek may
be well guarded; however, I cannot trust my peers at the Arcanum
not to betray me in the final moments and claim the prize for
themselves. For this reason, I have hired specialized individuals to
accompany me on this journey. Capable as they may be, these brutes
will be far less likely to recognize the true potential of the relic and
less interested in it even if they do, once they’ve been paid.
I stand on the brink of greatness. All I must do is claim it. And
claim it, I shall, fervently. Before long, I will be one of the most
powerful beings on the face of the world!"#;

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

    let pdf_path = "../../test_inputs/Research Notes.pdf";
    assert!(Path::new(pdf_path).exists(), "Research Notes PDF not found at: {}", pdf_path);

    // ========================================================
    // PASS 1: Static Layout Extraction & Token Verification
    // ========================================================
    let doc_id = format!("doc-uuid-{}", sha2_hash(pdf_path));
    let extractor = RealPdfExtractor {
        document_id: doc_id.clone(),
        pdf_path: pdf_path.to_string(),
    };

    let lopdf_doc = lopdf::Document::load(pdf_path).expect("Failed to load PDF with lopdf");
    let page_count = lopdf_doc.get_pages().len();

    // Extract all pages and concatenate
    let mut full_extracted_raw = String::new();
    for p in 1..=page_count {
        let page_extraction = extractor.extract_page(p as u32)
            .expect("Pass 1: PDF extraction failed");
        full_extracted_raw.push_str(&page_extraction.raw_text);
        full_extracted_raw.push(' ');
    }

    // Strip [Image: ...] and [Caption: ...] tags
    let mut cleaned_text = String::new();
    let mut chars = full_extracted_raw.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '[' {
            let mut tag = String::new();
            while let Some(&next_c) = chars.peek() {
                if next_c == ']' {
                    chars.next();
                    break;
                }
                tag.push(chars.next().unwrap());
            }
            if tag.starts_with("Image:") || tag.starts_with("Caption:") {
                // Skip the tag
            } else {
                cleaned_text.push('[');
                cleaned_text.push_str(&tag);
                cleaned_text.push(']');
            }
        } else {
            cleaned_text.push(c);
        }
    }

    let page_extraction = extractor.extract_page(1).expect("Failed to extract page 1 again");

    // Token diff validation to ensure 100% character-level accuracy of extracted words
    let extracted_tokens: Vec<&str> = cleaned_text.split_whitespace().collect();
    let reference_tokens: Vec<&str> = GROUND_TRUTH.split_whitespace().collect();

    println!("Extracted tokens count: {}", extracted_tokens.len());
    println!("Reference tokens count: {}", reference_tokens.len());

    assert_eq!(
        extracted_tokens.len(),
        reference_tokens.len(),
        "Token count mismatch! Extracted: {}, Reference: {}",
        extracted_tokens.len(),
        reference_tokens.len()
    );

    for (i, (ext_tok, ref_tok)) in extracted_tokens.iter().zip(reference_tokens.iter()).enumerate() {
        assert_eq!(
            ext_tok,
            ref_tok,
            "Token mismatch at index {}! Extracted: '{}', Reference: '{}'",
            i,
            ext_tok,
            ref_tok
        );
    }

    println!("Token matching diff verified: 100% character-level token match ({} tokens)", extracted_tokens.len());

    assert_eq!(page_extraction.page_number, 1);
    assert_eq!(page_extraction.document_id, doc_id);
    assert!(!page_extraction.raw_text.is_empty(), "Extracted text buffer is empty");



    // ========================================================
    // PASS 2: Semantic Delineator Synthesizer
    // ========================================================
    let synthesized_extraction = DocumentDelineator::delineate_content(&page_extraction)
        .expect("Pass 2: Delineator synthesis failed");

    // Verify LLM structuring returns type-safe sections and blocks
    assert!(!synthesized_extraction.sections.is_empty(), "No chapters synthesized");
    assert!(!synthesized_extraction.blocks.is_empty(), "No blocks synthesized");

    for block in &synthesized_extraction.blocks {
        let ast: ASTNode = serde_json::from_str(&block.content)
            .expect("Delineator generated invalid ASTNode JSON structure");

        // Validate JSON properties based on type
        match block.block_type.as_str() {
            "heading" => {
                assert!(matches!(ast, ASTNode::Heading { .. }), "Heading block mismatch");
            }
            "paragraph" => {
                assert!(matches!(ast, ASTNode::Paragraph { .. }), "Paragraph block mismatch");
            }
            _ => {}
        }
    }

    // ========================================================
    // DATABASE HANDSHAKE & FTS5 VERIFICATION
    // ========================================================
    let db_path = "target/research_notes_test.db";
    if Path::new(db_path).exists() {
        let _ = fs::remove_file(db_path);
    }

    let mut conn = Connection::open(&db_path).expect("Failed to open test SQLite database");
    conn.execute_batch(DDL_MIGRATION).expect("Failed to initialize SQLite schemas & triggers");

    // Atomic transaction write
    let tx = conn.transaction().expect("Failed to open write transaction");

    let corpus_uuid = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO corpora (id, name, description) VALUES (?, ?, ?)",
        params![corpus_uuid, "Research Notes Corpus", "Verification Corpus for Research Notes"],
    ).expect("Failed to insert corpus");

    tx.execute(
        "INSERT INTO documents (id, corpus_id, title, author, source_type, sha256_hash, storage_path) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![
            doc_id,
            corpus_uuid,
            "Research Notes",
            "Novice Arcanist",
            "pdf",
            sha2_hash(pdf_path),
            pdf_path
        ],
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

    tx.commit().expect("Failed to commit SQLite transaction");

    // Verify FTS table population and HTML/JSON stripping
    let mut stmt = conn.prepare("SELECT block_id, content FROM blocks_fts").unwrap();
    let fts_rows: Vec<(String, String)> = stmt.query_map([], |row| {
        Ok((row.get(0)?, row.get(1)?))
    }).unwrap().map(Result::unwrap).collect();

    assert!(!fts_rows.is_empty(), "FTS table is empty! Trigger failed.");

    for (_, fts_content) in &fts_rows {
        assert!(!fts_content.contains("\"type\":"), "FTS content contains AST JSON keys: {}", fts_content);
        assert!(!fts_content.starts_with('{'), "FTS content is not stripped: {}", fts_content);
    }

    println!("SQLite database handshake and JSON-AST FTS5 verification successful.");

    cleanup_mock_inference();
}
