use contracts::error::AppError;
use super::DocumentParser;

pub struct WordParser;

impl DocumentParser for WordParser {
    fn parse<'a>(&self, _file_path: &str) -> Result<String, AppError> {
        // TODO: Implement DOCX parsing logic returning a unified ASTNode schema
        unimplemented!("Word document parsing is not yet implemented.")
    }

    fn extract_assets(&self, _file_path: &str, _output_dir: &str) -> Result<Vec<String>, AppError> {
        // TODO: Implement DOCX embedded asset extraction
        unimplemented!("Word document asset extraction is not yet implemented.")
    }
}
