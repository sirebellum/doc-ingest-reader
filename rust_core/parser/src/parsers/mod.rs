use anyhow::Result;

pub trait DocumentParser {
    /// Parses the document and returns a serialized JSON string representing CanonicalDocument or PageExtraction schema.
    fn parse<'a>(&self, file_path: &str) -> Result<String>;
    
    /// Future-proofed method to handle embedded assets, extracting them to a sandbox directory and returning `local-asset://` URIs.
    fn extract_assets(&self, file_path: &str, output_dir: &str) -> Result<Vec<String>>;
}

pub mod pdf_parser;
pub mod epub_parser;
pub mod markdown_parser;
pub mod html_parser;
pub mod word_parser;
