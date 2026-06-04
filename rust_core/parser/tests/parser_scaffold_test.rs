use parser::{
    BlockType, ExtractedBlock, LLMStructuringOutput, LayoutHint, MockPdfExtractor,
    PageExtraction, PdfExtractor, parse_pdf, sha2_hash, ASTNode,
};

#[test]
fn test_serialization_scaffold() {
    let hint = LayoutHint {
        bounding_box: [10.0, 20.0, 200.0, 40.0],
        font_size: 14.0,
        text_snippet: "Mock Section Heading".to_string(),
    };

    let extraction = PageExtraction {
        document_id: "doc-123".to_string(),
        page_number: 1,
        overlap_context: "previous context".to_string(),
        raw_text: "Hello Scaffold on Page 1".to_string(),
        layout_hints: vec![hint],
        extracted_images: vec![],
    };

    let serialized = serde_json::to_string(&extraction).unwrap();
    let deserialized: PageExtraction = serde_json::from_str(&serialized).unwrap();

    assert_eq!(deserialized.document_id, "doc-123");
    assert_eq!(deserialized.page_number, 1);
    assert_eq!(deserialized.layout_hints[0].text_snippet, "Mock Section Heading");
}

#[test]
fn test_block_types_and_llm_outputs() {
    let block = ExtractedBlock {
        block_type: BlockType::Heading,
        content: ASTNode::Heading {
            level: 2,
            children: vec![ASTNode::Text {
                text: "Chapter 1".to_string(),
                bold: None,
                italic: None,
                code: None,
            }],
        },
        hyperlink_targets: vec!["#ch2".to_string()],
        semantic_tags: vec!["intro".to_string()],
    };

    let output = LLMStructuringOutput {
        blocks: vec![block],
    };

    let serialized = serde_json::to_string(&output).unwrap();
    let deserialized: LLMStructuringOutput = serde_json::from_str(&serialized).unwrap();

    assert_eq!(deserialized.blocks[0].block_type, BlockType::Heading);
    assert_eq!(
        deserialized.blocks[0].content,
        ASTNode::Heading {
            level: 2,
            children: vec![ASTNode::Text {
                text: "Chapter 1".to_string(),
                bold: None,
                italic: None,
                code: None,
            }],
        }
    );
    assert_eq!(deserialized.blocks[0].hyperlink_targets[0], "#ch2");
}

#[test]
fn test_pdf_extractor_trait_with_mock() {
    let extractor = MockPdfExtractor {
        document_id: "doc-mock-uuid".to_string(),
    };

    let page = extractor.extract_page(1).unwrap();
    assert_eq!(page.document_id, "doc-mock-uuid");
    assert_eq!(page.page_number, 1);
    assert_eq!(page.layout_hints[0].font_size, 14.0);

    let images = extractor.extract_images("sandbox/").unwrap();
    assert_eq!(images.len(), 1);
    assert_eq!(images[0], "mock_image_synthetic_simulation_stub_1.png");
}

#[test]
fn test_parse_pdf_function() {
    let res = parse_pdf("sample.pdf").unwrap();
    let deserialized: PageExtraction = serde_json::from_str(&res).unwrap();
    assert_eq!(deserialized.page_number, 1);
    assert_eq!(deserialized.document_id, format!("doc-uuid-{}", sha2_hash("sample.pdf")));
}
