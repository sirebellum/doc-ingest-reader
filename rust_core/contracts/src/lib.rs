use serde::{Serialize, Deserialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../../mobile/src/shared/types/BlockType.ts")]
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
#[ts(export, export_to = "../../../mobile/src/shared/types/ASTNode.ts")]
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        bold: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        italic: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
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
#[ts(export, export_to = "../../../mobile/src/shared/types/TableRow.ts")]
pub struct TableRow {
    pub cells: Vec<TableCell>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export, export_to = "../../../mobile/src/shared/types/TableCell.ts")]
pub struct TableCell {
    pub children: Vec<ASTNode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_header: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export, export_to = "../../../mobile/src/shared/types/ListItem.ts")]
pub struct ListItem {
    pub children: Vec<ASTNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export, export_to = "../../../mobile/src/shared/types/ExtractedBlock.ts")]
pub struct ExtractedBlock {
    pub block_type: BlockType,
    pub content: ASTNode,
    pub hyperlink_targets: Vec<String>,
    pub semantic_tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export, export_to = "../../../mobile/src/shared/types/LLMStructuringOutput.ts")]
pub struct LLMStructuringOutput {
    pub blocks: Vec<ExtractedBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export, export_to = "../../../mobile/src/shared/types/LayoutHint.ts")]
pub struct LayoutHint {
    pub bounding_box: [f32; 4],
    pub font_size: f32,
    pub text_snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export, export_to = "../../../mobile/src/shared/types/ExtractedImageMetadata.ts")]
pub struct ExtractedImageMetadata {
    pub image_id: String,
    pub sha256_hash: String,
    pub bounding_box: [f32; 4],
    pub page_width: f32,
    pub page_height: f32,
    pub local_uri: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export, export_to = "../../../mobile/src/shared/types/PageExtraction.ts")]
pub struct PageExtraction {
    pub document_id: String,
    pub page_number: u32,
    pub overlap_context: String,
    pub raw_text: String,
    pub layout_hints: Vec<LayoutHint>,
    pub extracted_images: Vec<ExtractedImageMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export, export_to = "../../../mobile/src/shared/types/StructuredSection.ts")]
pub struct StructuredSection {
    pub id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub depth_level: u32,
    pub sort_order: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export, export_to = "../../../mobile/src/shared/types/StructuredBlock.ts")]
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
#[ts(export, export_to = "../../../mobile/src/shared/types/MultiFormatExtraction.ts")]
pub struct MultiFormatExtraction {
    pub document_id: String,
    pub source_type: String,
    pub title: String,
    pub author: Option<String>,
    pub sections: Vec<StructuredSection>,
    pub blocks: Vec<StructuredBlock>,
    pub extracted_images: Vec<ExtractedImageMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export, export_to = "../../../mobile/src/shared/types/DocumentIndexItem.ts")]
pub struct DocumentIndexItem {
    pub title: String,
    pub page_start: u32,
    pub level: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export, export_to = "../../../mobile/src/shared/types/DocumentIndex.ts")]
pub struct DocumentIndex {
    pub items: Vec<DocumentIndexItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
#[ts(export, export_to = "../../../mobile/src/shared/types/ExtractedMetadata.ts")]
pub enum ExtractedMetadata {
    Index(DocumentIndex),
    Tags(Vec<String>),
    Summary(String),
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_export() {
        // Handled automatically by #[ts(export, export_to = "...")]
    }
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
