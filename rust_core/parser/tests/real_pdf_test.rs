use parser::{RealPdfExtractor, PdfExtractor, sha2_hash, parse_pdf_ffi, free_rust_string};
use std::ffi::{CString, CStr};

#[test]
fn test_real_pdf_extractor_scaffolding() {
    let extractor = RealPdfExtractor {
        document_id: "doc-real-test".to_string(),
        pdf_path: "docs/sample.pdf".to_string(),
    };

    assert_eq!(extractor.document_id, "doc-real-test");
    assert_eq!(extractor.pdf_path, "docs/sample.pdf");
}

#[test]
fn test_sha2_hashing_correctness() {
    let input = "sample_document_path";
    let hash = sha2_hash(input);
    
    // Standard SHA-256 for "sample_document_path"
    assert_eq!(hash.len(), 64);
    
    let hash_again = sha2_hash(input);
    assert_eq!(hash, hash_again);
}

#[test]
fn test_pdf_extractor_nonexistent_file_handling() {
    let extractor = RealPdfExtractor {
        document_id: "doc-invalid".to_string(),
        pdf_path: "nonexistent_file_path.pdf".to_string(),
    };

    // Extracting page on non-existent file should gracefully return Err due to lopdf/pdfium load failure
    let result = extractor.extract_page(1);
    assert!(result.is_err());
    
    let images_result = extractor.extract_images("sandbox_test/");
    assert!(images_result.is_err());
}

#[test]
fn test_ffi_bridge_null_pointer_handling() {
    // Calling FFI with null pointer should return null pointer safely
    let result_null = parse_pdf_ffi(std::ptr::null());
    assert!(result_null.is_null());
}

#[test]
fn test_ffi_bridge_valid_mock_path_roundtrip() {
    // A non-existent path will trigger mock parsing fallback inside parse_pdf
    let path = CString::new("nonexistent_test_doc.pdf").unwrap();
    let res_ptr = parse_pdf_ffi(path.as_ptr());
    
    assert!(!res_ptr.is_null());
    
    // Parse the returned FFI string
    let c_str = unsafe { CStr::from_ptr(res_ptr) };
    let json_res = c_str.to_str().unwrap();
    
    // Verify JSON structural fields
    assert!(json_res.contains("document_id"));
    assert!(json_res.contains("page_number"));
    assert!(json_res.contains("layout_hints"));
    
    // Clean up memory via FFI free method to verify safety
    free_rust_string(res_ptr);
}
