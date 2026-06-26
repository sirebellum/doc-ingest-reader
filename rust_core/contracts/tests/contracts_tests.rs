use contracts::{
    ASTNode, TableRow, TableCell, ListItem,
    error::AppError, Block, Document, MultiFormatExtraction,
};

#[test]
fn test_ast_node_serde_round_trip() {
    // Build a complex nested AST tree covering multiple NodeKind variants
    let ast = ASTNode::Heading {
        level: 2,
        children: vec![
            ASTNode::Text {
                text: "Introduction".to_string(),
                bold: Some(true),
                italic: None,
                code: None,
            },
            ASTNode::Link {
                url: "https://example.com".to_string(),
                children: vec![
                    ASTNode::Text {
                        text: "click here".to_string(),
                        bold: None,
                        italic: Some(true),
                        code: None,
                    },
                ],
            },
        ],
    };

    let json = serde_json::to_string(&ast).unwrap();
    let deserialized: ASTNode = serde_json::from_str(&json).unwrap();
    assert_eq!(ast, deserialized);

    // Test Paragraph variant with nested children
    let paragraph = ASTNode::Paragraph {
        children: vec![
            ASTNode::Text {
                text: "Hello ".to_string(),
                bold: None,
                italic: None,
                code: None,
            },
            ASTNode::Text {
                text: "world".to_string(),
                bold: Some(true),
                italic: None,
                code: Some(true),
            },
        ],
    };
    let json = serde_json::to_string(&paragraph).unwrap();
    let deserialized: ASTNode = serde_json::from_str(&json).unwrap();
    assert_eq!(paragraph, deserialized);

    // Test Table variant with rows, cells, and header metadata
    let table = ASTNode::Table {
        rows: vec![
            TableRow {
                cells: vec![
                    TableCell {
                        children: vec![ASTNode::Text {
                            text: "Header".to_string(),
                            bold: Some(true),
                            italic: None,
                            code: None,
                        }],
                        is_header: Some(true),
                    },
                ],
            },
            TableRow {
                cells: vec![
                    TableCell {
                        children: vec![ASTNode::Text {
                            text: "Data".to_string(),
                            bold: None,
                            italic: None,
                            code: None,
                        }],
                        is_header: None,
                    },
                ],
            },
        ],
    };
    let json = serde_json::to_string(&table).unwrap();
    let deserialized: ASTNode = serde_json::from_str(&json).unwrap();
    assert_eq!(table, deserialized);

    // Test Image variant with optional fields
    let image = ASTNode::Image {
        src: "img.png".to_string(),
        alt: Some("an image".to_string()),
        caption: None,
    };
    let json = serde_json::to_string(&image).unwrap();
    let deserialized: ASTNode = serde_json::from_str(&json).unwrap();
    assert_eq!(image, deserialized);

    // Test CodeBlock variant
    let code = ASTNode::CodeBlock {
        code: "fn main() {}".to_string(),
        language: Some("rust".to_string()),
    };
    let json = serde_json::to_string(&code).unwrap();
    let deserialized: ASTNode = serde_json::from_str(&json).unwrap();
    assert_eq!(code, deserialized);

    // Test Quote variant
    let quote = ASTNode::Quote {
        children: vec![ASTNode::Text {
            text: "To be or not to be".to_string(),
            bold: None,
            italic: Some(true),
            code: None,
        }],
    };
    let json = serde_json::to_string(&quote).unwrap();
    let deserialized: ASTNode = serde_json::from_str(&json).unwrap();
    assert_eq!(quote, deserialized);

    // Test List variant with ordered items
    let list = ASTNode::List {
        ordered: true,
        items: vec![
            ListItem {
                children: vec![ASTNode::Text {
                    text: "First".to_string(),
                    bold: None,
                    italic: None,
                    code: None,
                }],
            },
            ListItem {
                children: vec![ASTNode::Text {
                    text: "Second".to_string(),
                    bold: None,
                    italic: None,
                    code: None,
                }],
            },
        ],
    };
    let json = serde_json::to_string(&list).unwrap();
    let deserialized: ASTNode = serde_json::from_str(&json).unwrap();
    assert_eq!(list, deserialized);
}

#[test]
fn test_app_error_display_output() {
    // Verify Display output for at least 3 AppError variants
    let layout_err = AppError::LayoutParsingError("bad geometry".to_string());
    assert_eq!(layout_err.to_string(), "Layout parsing error: bad geometry");

    let db_collision = AppError::DatabaseCollision("block xyz exists".to_string());
    assert_eq!(db_collision.to_string(), "Database collision: block xyz exists");

    let ffi_err = AppError::FfiEncodingFault("invalid utf-8".to_string());
    assert_eq!(ffi_err.to_string(), "FFI encoding fault: invalid utf-8");

    let ctx_overflow = AppError::ContextOverflow("exceeded 4096 tokens".to_string());
    assert_eq!(ctx_overflow.to_string(), "Context overflow: exceeded 4096 tokens");

    let db_err = AppError::DatabaseError("connection refused".to_string());
    assert_eq!(db_err.to_string(), "Database error: connection refused");

    let net_err = AppError::NetworkError("timeout".to_string());
    assert_eq!(net_err.to_string(), "Network error: timeout");

    let generic_err = AppError::Generic("something went wrong".to_string());
    assert_eq!(generic_err.to_string(), "Internal error: something went wrong");
}

#[test]
fn test_domain_models_serde_round_trip() {
    // Test Block
    let block = Block {
        id: "block-1".to_string(),
        section_id: "sec-1".to_string(),
        document_id: "doc-1".to_string(),
        block_type: "paragraph".to_string(),
        content: "Hello".to_string(),
        sort_order: 1,
        estimated_height: None,
    };
    let json = serde_json::to_string(&block).unwrap();
    // Verify optional field is omitted
    assert!(!json.contains("estimated_height"));
    let deserialized: Block = serde_json::from_str(&json).unwrap();
    assert_eq!(block, deserialized);

    // Test Document
    let document = Document {
        id: "doc-1".to_string(),
        title: "Title".to_string(),
        sha256_hash: "hash".to_string(),
        author: Some("Author".to_string()),
        source_type: None,
    };
    let json = serde_json::to_string(&document).unwrap();
    assert!(!json.contains("source_type"));
    let deserialized: Document = serde_json::from_str(&json).unwrap();
    assert_eq!(document, deserialized);

    // Test MultiFormatExtraction
    let mfe = MultiFormatExtraction {
        document_id: "doc-1".to_string(),
        source_type: "pdf".to_string(),
        title: "Test".to_string(),
        author: None,
        sections: vec![],
        blocks: vec![],
        extracted_images: vec![],
    };
    let json = serde_json::to_string(&mfe).unwrap();
    assert!(!json.contains("author"));
    let deserialized: MultiFormatExtraction = serde_json::from_str(&json).unwrap();
    assert_eq!(mfe, deserialized);
}
