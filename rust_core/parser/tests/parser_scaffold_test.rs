use parser::{
    BlockType, ExtractedBlock, LLMStructuringOutput, LayoutHint, MockPdfExtractor,
    PageExtraction, PdfExtractor, parse_pdf, parse_html, parse_markdown, parse_epub, sha2_hash, ASTNode, MultiFormatExtraction,
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

#[test]
fn test_parse_html_multiple_scripts() {
    use std::fs::File;
    use std::io::Write;
    let path = "test_multiple_scripts.html";
    let mut file = File::create(path).unwrap();
    file.write_all(b"<html><head><title>Test</title></head><body><script>alert(1);</script><p>Hello</p><script>alert(2);</script></body></html>").unwrap();
    
    let res = parse_html(path).unwrap();
    std::fs::remove_file(path).unwrap();
    
    assert!(!res.contains("alert(1)"));
    assert!(!res.contains("alert(2)"));
    assert!(res.contains("Hello"));
}

#[test]
fn test_parse_html_tags_with_attributes() {
    use std::fs::File;
    use std::io::Write;
    let path = "test_html_attributes.html";
    let mut file = File::create(path).unwrap();
    file.write_all(b"<html><head id=\"main-head\" class=\"meta\"><title>Test</title></head><body><script src=\"app.js\"></script><p>Hello</p><script type=\"text/javascript\">alert(2);</script></body></html>").unwrap();
    
    let res = parse_html(path).unwrap();
    std::fs::remove_file(path).unwrap();
    
    assert!(!res.contains("alert(2)"));
    assert!(!res.contains("app.js"));
    assert!(!res.contains("main-head"));
    assert!(res.contains("Hello"));
}

#[test]
fn test_parse_markdown_multibyte_and_headings() {
    use std::fs::File;
    use std::io::Write;
    let path = "test_markdown_multibyte.md";
    let mut file = File::create(path).unwrap();
    // Test multibyte text in heading, and ensure space requirement is respected
    // "###标题" (no space) should be parsed as a paragraph (or just ignored as heading)
    // "## 标题" (with space) should be parsed as a heading
    file.write_all("## 标题\nSome text\n###NoSpaceHeading\n".as_bytes()).unwrap();
    
    let res = parse_markdown(path).unwrap();
    std::fs::remove_file(path).unwrap();
    
    let extraction: MultiFormatExtraction = serde_json::from_str(&res).unwrap();
    
    // There should be a default section, and then "标题" section
    assert!(extraction.sections.iter().any(|s| s.title == "标题"));
    
    // "###NoSpaceHeading" should not be a section because of missing space
    assert!(!extraction.sections.iter().any(|s| s.title == "NoSpaceHeading"));
}

#[test]
fn test_parse_epub_scaffold() {
    // We don't have a real epub, but parse_epub has a fallback to simulated content
    let path = "nonexistent_simulated.epub";
    let res = parse_epub(path).unwrap();
    let extraction: MultiFormatExtraction = serde_json::from_str(&res).unwrap();
    
    assert_eq!(extraction.source_type, "epub");
    assert_eq!(extraction.title, "EPUB Document");
}
