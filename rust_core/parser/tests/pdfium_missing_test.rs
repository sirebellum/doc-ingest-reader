use parser::RealPdfExtractor;
use parser::PdfExtractor;
use std::env;
use std::thread;

#[test]
fn test_missing_pdfium_bubbles_error() {
    let old_cwd = env::current_dir().unwrap();
    let old_dyld = env::var_os("DYLD_LIBRARY_PATH");
    let old_ld = env::var_os("LD_LIBRARY_PATH");

    // Clear environment variables
    env::remove_var("DYLD_LIBRARY_PATH");
    env::remove_var("LD_LIBRARY_PATH");

    // Change CWD to a temp directory to ensure ./libpdfium.dylib is not found
    let temp_dir = std::env::temp_dir();
    env::set_current_dir(&temp_dir).unwrap();

    let result = thread::spawn(|| {
        let extractor = RealPdfExtractor {
            document_id: "test_doc".to_string(),
            pdf_path: "dummy_path.pdf".to_string(),
        };

        let err_page = extractor.extract_page(1);
        let err_img = extractor.extract_images("dummy_out_dir");
        
        (err_page, err_img)
    }).join().unwrap();

    // Restore environment
    env::set_current_dir(&old_cwd).unwrap();
    if let Some(val) = old_dyld {
        env::set_var("DYLD_LIBRARY_PATH", val);
    }
    if let Some(val) = old_ld {
        env::set_var("LD_LIBRARY_PATH", val);
    }

    // Verify results
    assert!(result.0.is_err(), "Expected extract_page to bubble up an error");
    assert!(result.1.is_err(), "Expected extract_images to bubble up an error");

    match result.0.unwrap_err() {
        contracts::error::AppError::Generic(_) | contracts::error::AppError::LayoutParsingError(_) => {
            // success
        },
        other => panic!("Unexpected error type: {:?}", other),
    }

    match result.1.unwrap_err() {
        contracts::error::AppError::Generic(_) | contracts::error::AppError::LayoutParsingError(_) => {
            // success
        },
        other => panic!("Unexpected error type: {:?}", other),
    }
}
