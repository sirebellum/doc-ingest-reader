//! Pass 2 Delineator Crate.
//! Provides logic to partition and segment raw extracted document text into logical, indexable blocks,
//! particularly when documents (such as PDFs or EPUBs) do not contain native Chapter links or structural Table of Contents elements.

use anyhow::Result;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use serde_json;

use contracts::{
    PageExtraction, MultiFormatExtraction, LLMStructuringOutput,
    StructuredSection, StructuredBlock, ASTNode, BlockType, LayoutHint,
    DocumentIndex, ExtractedMetadata
};

pub const DEFAULT_MODEL_REPO: &str = "unsloth/gemma-4-E2B-it-GGUF";
pub const DEFAULT_MODEL_FILE: &str = "gemma-4-E2B-it-UD-IQ2_M.gguf";
pub const DEFAULT_MODEL_URL: &str = "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-UD-IQ2_M.gguf";
pub const DEFAULT_MODEL_SHA256: &str = "60f84cb5b9512175f219506da4a5d98d30b112855c474a3a6f06f6596dc7fd9b";

pub fn verify_and_download_model(model_path: &str) -> Result<()> {
    let path = std::path::Path::new(model_path);
    if path.to_string_lossy().contains("dummy") {
        if !path.exists() {
            std::fs::File::create(path)?;
        }
        return Ok(());
    }

    // Call downloader to guarantee full asset presence prior to boot sequences
    inference::downloader::ModelDownloader::download_model(
        DEFAULT_MODEL_URL,
        path,
        Some(DEFAULT_MODEL_SHA256),
        None::<fn(f64)>,
    )?;
    Ok(())
}

fn clean_json_markers(input: &str) -> String {
    let mut cleaned = input.trim();
    if cleaned.starts_with("```") {
        if cleaned.starts_with("```json") {
            cleaned = cleaned.trim_start_matches("```json");
        } else {
            cleaned = cleaned.trim_start_matches("```");
        }
        cleaned = cleaned.trim_end_matches("```");
    }
    cleaned.trim().to_string()
}

fn heuristic_repair_json(input: &str) -> String {
    let mut repaired = input.trim().to_string();
    
    let open_braces = repaired.chars().filter(|&c| c == '{').count();
    let close_braces = repaired.chars().filter(|&c| c == '}').count();
    if open_braces > close_braces {
        repaired.push_str(&"}".repeat(open_braces - close_braces));
    }
    
    let open_brackets = repaired.chars().filter(|&c| c == '[').count();
    let close_brackets = repaired.chars().filter(|&c| c == ']').count();
    if open_brackets > close_brackets {
        repaired.push_str(&"]".repeat(open_brackets - close_brackets));
    }
    
    repaired
}

pub trait MetadataExtractor {
    fn extract(&self, page: &PageExtraction, model_path: Option<&str>) -> Result<ExtractedMetadata>;
}

pub struct IndexExtractor;

impl IndexExtractor {
    pub fn new() -> Self {
        Self
    }
}

impl Default for IndexExtractor {
    fn default() -> Self {
        Self::new()
    }
}

impl MetadataExtractor for IndexExtractor {
    fn extract(&self, page: &PageExtraction, model_path: Option<&str>) -> Result<ExtractedMetadata> {
        let system_prompt = "You are a professional assistant that extracts structured document indices (Table of Contents / chapters / sections) from page content.
You will be provided with:
1. Overlap Context: Text from the end of the previous page. Use this ONLY for context and continuity.
2. Raw Extracted Text: The actual text of the current page. Only extract headings and chapters from this text.

Rules:
1. Extract any chapter titles, section headers, or sub-headings found in the Raw Extracted Text.
2. For each extracted index item, specify:
   - \"title\": The clean title of the chapter/section.
   - \"page_start\": The page number of the current page.
   - \"level\": Depth level (1 for Chapter, 2 for Section, 3 for Subsection).
3. Do NOT extract any index items from the Overlap Context. The Overlap Context is provided ONLY to help you resolve partial sentences/headings spanning page boundaries.
4. Do NOT duplicate index items or output overlapping headers.
5. Your output must be a strict JSON payload matching the DocumentIndex schema:
{
  \"items\": [
    { \"title\": \"Chapter/Section Title\", \"page_start\": number, \"level\": number }
  ]
}
6. Do NOT wrap the output in markdown fences (e.g. ```json). Only return raw JSON.";

        let user_prompt = format!(
            "Document ID: {}\nPage Number: {}\nOverlap Context: {}\nRaw Extracted Text:\n{}",
            page.document_id,
            page.page_number,
            page.overlap_context,
            page.raw_text
        );

        let full_prompt = format!("{}\n\nInput Payload:\n{}", system_prompt, user_prompt);

        contracts::log_debug!(
            "PASS_2",
            "IndexExtractor",
            "Prepared IndexExtractor prompt payload",
            format!("PromptBytes: {}, OverlapBytes: {}, Status: Success", full_prompt.len(), page.overlap_context.len())
        );

        if let Some(path) = model_path {
            verify_and_download_model(path)?;
            inference::initialize_inference_context(path)?;
        }

        let output_str = inference::run_local_inference(&full_prompt)?;

        contracts::log_debug!(
            "PASS_2",
            "IndexExtractor",
            "Received raw model output from local inference",
            format!(
                "PromptTokens: {}, ResponseTokens: {}, ResponseBytes: {}, Status: Success",
                full_prompt.len() / 4,
                output_str.len() / 4,
                output_str.len()
            )
        );

        let cleaned = clean_json_markers(&output_str);
        let index: DocumentIndex = match serde_json::from_str(&cleaned) {
            Ok(idx) => idx,
            Err(e) => {
                println!("[IndexExtractor] JSON parsing failed: {:?}. Attempting heuristic recovery.", e);
                let repaired = heuristic_repair_json(&cleaned);
                match serde_json::from_str(&repaired) {
                    Ok(idx) => idx,
                    Err(_) => {
                        println!("[IndexExtractor] Heuristic recovery failed. Returning empty DocumentIndex.");
                        DocumentIndex { items: vec![] }
                    }
                }
            }
        };

        Ok(ExtractedMetadata::Index(index))
    }
}

pub struct MetadataPipeline {
    extractors: Vec<Box<dyn MetadataExtractor>>,
}

impl MetadataPipeline {
    pub fn new() -> Self {
        Self { extractors: Vec::new() }
    }

    pub fn add_extractor(&mut self, extractor: Box<dyn MetadataExtractor>) {
        self.extractors.push(extractor);
    }

    pub fn process(&self, page: &PageExtraction, model_path: Option<&str>) -> Result<Vec<ExtractedMetadata>> {
        let mut results = Vec::new();
        for extractor in &self.extractors {
            let res = extractor.extract(page, model_path)?;
            results.push(res);
        }
        Ok(results)
    }
}

impl Default for MetadataPipeline {
    fn default() -> Self {
        Self::new()
    }
}

fn generate_layout_heuristics(hints: &[LayoutHint]) -> String {
    if hints.is_empty() {
        return "No layout hints available.".to_string();
    }

    let mut heuristics = Vec::new();
    
    // 1. Calculate average/median font size to detect transitions
    let mut font_sizes: Vec<f32> = hints.iter().map(|h| h.font_size).collect();
    font_sizes.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median_font_size = font_sizes[font_sizes.len() / 2];
    heuristics.push(format!("Base/median font size detected: {:.1}pt", median_font_size));

    // 2. Scan segments and detect headings, paragraph breaks, large spacing
    let mut prev_y: Option<f32> = None;
    for (idx, hint) in hints.iter().enumerate() {
        let mut features = Vec::new();

        // Font size transition
        if hint.font_size > median_font_size * 1.2 {
            features.push(format!("large font ({:.1}pt)", hint.font_size));
        }

        // Vertical margin/spacing transition
        if let Some(py) = prev_y {
            // py (previous bottom) - current top
            let gap = py - hint.bounding_box[3]; 
            if gap > 15.0 {
                features.push(format!("vertical margin gap ({:.1}pt)", gap));
            }
        }

        // Semantic patterns
        let snippet = hint.text_snippet.trim();
        if snippet.starts_with("Chapter") || snippet.starts_with("Section") || snippet.starts_with("Part") {
            features.push("semantic chapter/section keyword prefix".to_string());
        } else if snippet.chars().next().map_or(false, |c| c.is_ascii_digit()) && snippet.contains('.') {
            features.push("numbered section prefix pattern".to_string());
        }

        if !features.is_empty() {
            heuristics.push(format!(
                "Segment {} (\"{:.20}...\"): {}",
                idx,
                snippet,
                features.join(", ")
            ));
        }

        prev_y = Some(hint.bounding_box[1]); // bottom
    }

    heuristics.join("\n")
}

pub struct DocumentDelineator;

impl DocumentDelineator {
    /// Delineates raw document content (e.g. from Pass 1) into semantic, indexable section/block segments.
    pub fn delineate_content(extraction: &PageExtraction) -> Result<MultiFormatExtraction> {
        let system_prompt = "You are a professional PDF parsing assistant. You will be provided with raw text extracted from a PDF page along with layout hints (bounding boxes, font sizes) and overlap context from the previous page. Your goal is to return a strict JSON payload segmenting the raw text into clean HTML/XHTML elements, identifying semantic tag targets, and mapping contextual search tags.
Rules:
1. Output MUST be valid JSON matching the LLMStructuringOutput schema: { \"blocks\": ExtractedBlock[] }
2. Each block has \"block_type\" ('heading', 'paragraph', 'table', 'code', 'image', 'quote'), \"content\" (JSON ASTNode), \"hyperlink_targets\" (string[]), and \"semantic_tags\" (string[]).
3. The ASTNode schema is a tagged union with \"type\" field:
   - Heading: { \"type\": \"heading\", \"level\": number, \"children\": ASTNode[] }
   - Paragraph: { \"type\": \"paragraph\", \"children\": ASTNode[] }
   - Text: { \"type\": \"text\", \"text\": string, \"bold\"?: boolean, \"italic\"?: boolean, \"code\"?: boolean }
   - Link: { \"type\": \"link\", \"url\": string, \"children\": ASTNode[] }
   - Image: { \"type\": \"image\", \"src\": string, \"alt\"?: string, \"caption\"?: string }
   - Table: { \"type\": \"table\", \"rows\": { \"cells\": { \"children\": ASTNode[], \"is_header\"?: boolean }[] }[] }
   - Quote: { \"type\": \"quote\", \"children\": ASTNode[] }
   - CodeBlock: { \"type\": \"code_block\", \"code\": string, \"language\"?: string }
   - List: { \"type\": \"list\", \"ordered\": boolean, \"items\": { \"children\": ASTNode[] }[] }
4. The overlap_context text is provided strictly for semantic continuity across page borders. You MUST omit this overlapping text from your generated output blocks to prevent text duplication in the database.
5. Do NOT include markdown wrappers or external code block fences (e.g. ```json) in your response. Only return the pure JSON object.";

        let heuristics = generate_layout_heuristics(&extraction.layout_hints);

        let user_prompt = format!(
            "Document ID: {}\nPage Number: {}\nOverlap Context: {}\nRaw Extracted Text:\n{}\nLayout Heuristics:\n{}\n\nGenerate structured blocks. Format of blocks must adhere to JSON mode.",
            extraction.document_id,
            extraction.page_number,
            extraction.overlap_context,
            extraction.raw_text,
            heuristics
        );

        let full_prompt = format!("{}\n\nInput Payload:\n{}", system_prompt, user_prompt);

        contracts::log_debug!(
            "PASS_2",
            "Delineator",
            "Prepared Delineator prompt payload with layout heuristics",
            format!("PromptBytes: {}, OverlapBytes: {}, Status: Success", full_prompt.len(), extraction.overlap_context.len())
        );

        // Execute local LLM offline inference using llama.cpp matrix
        let output_str = inference::run_local_inference(&full_prompt)?;

        contracts::log_debug!(
            "PASS_2",
            "Delineator",
            "Received raw model JSON response from local offline inference",
            format!(
                "PromptTokens: {}, ResponseTokens: {}, ResponseBytes: {}, Status: Success",
                full_prompt.len() / 4,
                output_str.len() / 4,
                output_str.len()
            )
        );

        // Decode strongly typed blocks
        let llm_output: LLMStructuringOutput = serde_json::from_str(&output_str)?;

        let mut sections = Vec::new();
        let mut blocks = Vec::new();
        
        let default_sec_id = format!("sec-{}-default", extraction.document_id);
        let mut current_section_id = default_sec_id.clone();
        let mut section_counter = 0;

        for (idx, block) in llm_output.blocks.into_iter().enumerate() {
            let block_id = format!("block-chunk-job-{}-{}-{}", extraction.document_id, extraction.page_number, idx);
            let mut block_section_id = current_section_id.clone();
            
            let block_type_str = match block.block_type {
                BlockType::Heading => "heading",
                BlockType::Paragraph => "paragraph",
                BlockType::Table => "table",
                BlockType::Code => "code",
                BlockType::Image => "image",
                BlockType::Quote => "quote",
            };

            if block.block_type == BlockType::Heading {
                let heading_title = get_plain_text_from_ast(&block.content);
                let section_title = if heading_title.is_empty() {
                    format!("Chapter {}", extraction.page_number)
                } else {
                    heading_title
                };

                section_counter += 1;
                let section_id = format!("sec-{}-{}-{}", extraction.document_id, extraction.page_number, idx);

                sections.push(StructuredSection {
                    id: section_id.clone(),
                    parent_id: None,
                    title: section_title,
                    depth_level: 1,
                    sort_order: extraction.page_number * 100 + section_counter,
                });

                current_section_id = section_id.clone();
                block_section_id = section_id;
            }

            let content_json = serde_json::to_string(&block.content)?;

            blocks.push(StructuredBlock {
                id: block_id,
                section_id: block_section_id,
                block_type: block_type_str.to_string(),
                content: content_json,
                sort_order: idx as u32,
                semantic_tags: block.semantic_tags,
            });
        }

        Ok(MultiFormatExtraction {
            document_id: extraction.document_id.clone(),
            source_type: "pdf".to_string(),
            title: "PDF Page".to_string(),
            author: None,
            sections,
            blocks,
            extracted_images: extraction.extracted_images.clone(),
        })
    }
}

/// Helper function to extract plain text recursively from ASTNode structures
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
                }).collect::<Vec<String>>().join(" | ")
            }).collect::<Vec<String>>().join("\n")
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

/// C FFI Export entry point for JSI Bridge integration
#[no_mangle]
pub extern "C" fn delineate_page_ffi(
    page_extraction_json: *const c_char,
    model_path: *const c_char,
) -> *mut c_char {
    if page_extraction_json.is_null() || model_path.is_null() {
        return std::ptr::null_mut();
    }

    let page_json_str = unsafe {
        match CStr::from_ptr(page_extraction_json).to_str() {
            Ok(s) => s,
            Err(_) => return std::ptr::null_mut(),
        }
    };

    let model_path_str = unsafe {
        match CStr::from_ptr(model_path).to_str() {
            Ok(s) => s,
            Err(_) => return std::ptr::null_mut(),
        }
    };

    let extraction: PageExtraction = match serde_json::from_str(page_json_str) {
        Ok(ext) => ext,
        Err(e) => {
            eprintln!("Failed to parse page extraction JSON in delineator FFI: {}", e);
            return std::ptr::null_mut();
        }
    };

    // If model path is supplied, ensure model is present and inference engine context has initialized
    if !model_path_str.is_empty() {
        if let Err(e) = verify_and_download_model(model_path_str) {
            eprintln!("Failed to guarantee model residency inside delineator FFI: {}", e);
            return std::ptr::null_mut();
        }
        if let Err(e) = inference::initialize_inference_context(model_path_str) {
            eprintln!("Failed to initialize inference context inside delineator FFI: {}", e);
            return std::ptr::null_mut();
        }
    }

    match DocumentDelineator::delineate_content(&extraction) {
        Ok(result) => {
            match serde_json::to_string(&result) {
                Ok(json_res) => {
                    match CString::new(json_res) {
                        Ok(c_str) => c_str.into_raw(),
                        Err(_) => std::ptr::null_mut(),
                    }
                }
                Err(_) => std::ptr::null_mut(),
            }
        }
        Err(e) => {
            eprintln!("Delineation failed inside FFI execution: {}", e);
            std::ptr::null_mut()
        }
    }
}

/// C FFI helper to release raw delineator string pointer
#[no_mangle]
pub extern "C" fn free_rust_delineator_string(s: *mut c_char) {
    if s.is_null() {
        return;
    }
    unsafe {
        let _ = CString::from_raw(s);
    }
}
