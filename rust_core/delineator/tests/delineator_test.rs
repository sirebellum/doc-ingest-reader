use delineator::{DocumentDelineator, delineate_page_ffi, free_rust_delineator_string};
use contracts::{PageExtraction, LayoutHint};
use std::ffi::{CString, CStr};
use std::fs::File;
use std::path::Path;

fn setup_mock_inference(dummy_path: &str) {
    if !Path::new(dummy_path).exists() {
        File::create(dummy_path).unwrap();
    }
    // Initialize mock context
    let _ = inference::initialize_inference_context(dummy_path);
}

fn cleanup_mock_inference(dummy_path: &str) {
    if Path::new(dummy_path).exists() {
        let _ = std::fs::remove_file(dummy_path);
    }
}

#[test]
fn test_delineator_scaffold() {
    let dummy_path = "dummy_model_scaffold.gguf";
    setup_mock_inference(dummy_path);

    let hint = LayoutHint {
        bounding_box: [10.0, 20.0, 200.0, 40.0],
        font_size: 14.0,
        text_snippet: "Chapter 1: Native Delineation".to_string(),
    };

    let extraction = PageExtraction {
        document_id: "doc-delineator-test".to_string(),
        page_number: 1,
        overlap_context: "overlap context to omit".to_string(),
        raw_text: "Chapter 1: Native Delineation. This is standard body text parsed offline.".to_string(),
        layout_hints: vec![hint],
        extracted_images: vec![],
    };

    let result = DocumentDelineator::delineate_content(&extraction).unwrap();
    
    assert_eq!(result.document_id, "doc-delineator-test");
    assert_eq!(result.source_type, "pdf");
    
    assert!(!result.blocks.is_empty());
    assert!(!result.sections.is_empty());
    
    assert_eq!(result.sections[0].title, "Chapter 1: Local Inference");
    assert_eq!(result.blocks[0].block_type, "heading");

    cleanup_mock_inference(dummy_path);
}

#[test]
fn test_delineator_ffi_null_handling() {
    let result_null = delineate_page_ffi(std::ptr::null(), std::ptr::null());
    assert!(result_null.is_null());
}

#[test]
fn test_delineator_ffi_roundtrip() {
    let dummy_path = "dummy_model_ffi.gguf";
    setup_mock_inference(dummy_path);

    let hint = LayoutHint {
        bounding_box: [10.0, 20.0, 200.0, 40.0],
        font_size: 14.0,
        text_snippet: "Chapter 1: FFI Delineator".to_string(),
    };

    let extraction = PageExtraction {
        document_id: "doc-ffi-test".to_string(),
        page_number: 1,
        overlap_context: "overlap context to omit".to_string(),
        raw_text: "Chapter 1: FFI Delineation. This is FFI body text parsed offline.".to_string(),
        layout_hints: vec![hint],
        extracted_images: vec![],
    };

    let page_json = serde_json::to_string(&extraction).unwrap();
    let page_cstring = CString::new(page_json).unwrap();
    let model_cstring = CString::new(dummy_path).unwrap();

    let res_ptr = delineate_page_ffi(page_cstring.as_ptr(), model_cstring.as_ptr());
    assert!(!res_ptr.is_null());

    let c_str = unsafe { CStr::from_ptr(res_ptr) };
    let json_res = c_str.to_str().unwrap();

    assert!(json_res.contains("document_id"));
    assert!(json_res.contains("sections"));
    assert!(json_res.contains("blocks"));

    free_rust_delineator_string(res_ptr);
    cleanup_mock_inference(dummy_path);
}

#[test]
fn test_delineator_layout_heuristics() {
    let dummy_path = "dummy_model_heuristics.gguf";
    setup_mock_inference(dummy_path);

    let hint_heading = LayoutHint {
        bounding_box: [10.0, 500.0, 200.0, 520.0],
        font_size: 18.0,
        text_snippet: "Chapter 1: Native Delineation".to_string(),
    };

    let hint_body1 = LayoutHint {
        bounding_box: [10.0, 400.0, 450.0, 420.0],
        font_size: 10.0,
        text_snippet: "This is standard body paragraph text on the page.".to_string(),
    };

    // A large gap of 80pt between body1 and body2
    let hint_body2 = LayoutHint {
        bounding_box: [10.0, 300.0, 450.0, 320.0],
        font_size: 10.0,
        text_snippet: "This is the second body paragraph after a vertical gap.".to_string(),
    };

    let extraction = PageExtraction {
        document_id: "doc-heuristic-test".to_string(),
        page_number: 1,
        overlap_context: "overlap context to omit".to_string(),
        raw_text: "Chapter 1: Native Delineation. This is standard body paragraph text on the page. This is the second body paragraph after a vertical gap.".to_string(),
        layout_hints: vec![hint_heading, hint_body1, hint_body2],
        extracted_images: vec![],
    };

    let result = DocumentDelineator::delineate_content(&extraction).unwrap();
    assert_eq!(result.document_id, "doc-heuristic-test");
    assert!(!result.blocks.is_empty());

    cleanup_mock_inference(dummy_path);
}
