use serde::{Serialize, Deserialize};
use ts_rs::TS;

pub mod error;
pub mod hash;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum BlockType {
    Heading,
    Paragraph,
    Table,
    Code,
    Image,
    Quote,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum ASTNode {
    Heading {
        level: u8,
        children: Vec<ASTNode>,
    },
    Paragraph {
        children: Vec<ASTNode>,
    },
    Text {
        text: String,
        #[serde(default)]
        
        bold: Option<bool>,
        #[serde(default)]
        
        italic: Option<bool>,
        #[serde(default)]
        
        code: Option<bool>,
    },
    Link {
        url: String,
        children: Vec<ASTNode>,
    },
    Image {
        src: String,
        alt: Option<String>,
        caption: Option<String>,
    },
    Table {
        rows: Vec<TableRow>,
    },
    Quote {
        children: Vec<ASTNode>,
    },
    CodeBlock {
        code: String,
        language: Option<String>,
    },
    List {
        ordered: bool,
        items: Vec<ListItem>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
pub struct TableRow {
    pub cells: Vec<TableCell>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
pub struct TableCell {
    pub children: Vec<ASTNode>,
    #[serde(default)]
    
    pub is_header: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
pub struct ListItem {
    pub children: Vec<ASTNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
pub struct ExtractedBlock {
    pub block_type: BlockType,
    pub content: ASTNode,
    pub hyperlink_targets: Vec<String>,
    pub semantic_tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
pub struct LLMStructuringOutput {
    pub blocks: Vec<ExtractedBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct LayoutHint {
    pub bounding_box: [f32; 4],
    pub font_size: f32,
    pub text_snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct ExtractedImageMetadata {
    pub image_id: String,
    pub sha256_hash: String,
    pub bounding_box: [f32; 4],
    pub page_width: f32,
    pub page_height: f32,
    pub local_uri: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct PageExtraction {
    pub document_id: String,
    pub page_number: u32,
    pub overlap_context: String,
    pub raw_text: String,
    pub layout_hints: Vec<LayoutHint>,
    pub extracted_images: Vec<ExtractedImageMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct ExtractionChunk {
    pub document_id: String,
    pub chunk_index: u32,
    pub raw_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
pub struct StructuredSection {
    pub id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub depth_level: u32,
    pub sort_order: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
pub struct StructuredBlock {
    pub id: String,
    pub section_id: String,
    pub block_type: String,
    pub content: String,
    pub sort_order: u32,
    #[serde(default)]
    pub semantic_tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct MultiFormatExtraction {
    pub document_id: String,
    pub source_type: String,
    pub title: String,
    #[ts(optional)] pub author: Option<String>,
    pub sections: Vec<StructuredSection>,
    pub blocks: Vec<StructuredBlock>,
    pub extracted_images: Vec<ExtractedImageMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
pub struct DocumentIndexItem {
    pub title: String,
    pub page_start: u32,
    pub level: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
pub struct DocumentIndex {
    pub items: Vec<DocumentIndexItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
#[ts(export)]
pub enum ExtractedMetadata {
    Index(DocumentIndex),
    Tags(Vec<String>),
    Summary(String),
}


#[macro_export]
macro_rules! log_debug {
    ($subsystem:expr, $module:expr, $msg:expr) => {
        #[cfg(feature = "verbose-logging")]
        {
            let epoch_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0);
            println!("[DEBUG][{}][{}::{}] -> {}", epoch_ms, $subsystem, $module, $msg);
        }
    };
    ($subsystem:expr, $module:expr, $msg:expr, $metrics:expr) => {
        #[cfg(feature = "verbose-logging")]
        {
            let epoch_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0);
            println!("[DEBUG][{}][{}::{}] -> {} | {}", epoch_ms, $subsystem, $module, $msg, $metrics);
        }
    };
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct Block {
    pub id: String,
    pub section_id: String,
    pub document_id: String,
    pub block_type: String,
    pub content: String,
    pub sort_order: i32,
    #[ts(optional)] pub estimated_height: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
pub struct Annotation {
    pub id: String,
    pub document_id: String,
    pub block_id: Option<String>,
    pub annotation_type: String,
    pub color_code: String,
    #[ts(optional)] pub highlighted_text: Option<String>,
    #[ts(optional)] pub note_body: Option<String>,
    #[ts(optional)] pub anchor_metadata: Option<String>,
    #[ts(optional)] pub created_at: Option<String>,
    #[ts(optional)] pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
pub struct Corpus {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
pub struct Document {
    pub id: String,
    pub title: String,
    pub sha256_hash: String,
    #[ts(optional)] pub author: Option<String>,
    #[ts(optional)] pub source_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
pub struct Section {
    pub id: String,
    pub title: String,
    pub sort_order: i32,
}
