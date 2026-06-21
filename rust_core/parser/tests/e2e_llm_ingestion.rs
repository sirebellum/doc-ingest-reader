use inference::downloader::ModelDownloader;
use std::fs;
use std::path::Path;

#[test]
#[ignore]
fn test_downloader_and_ingestion_pipeline() {
    // 1. Create target artifacts directory
    let artifacts_dir_raw = Path::new("../../test_artifacts/e2e_llm_ingestion"); fs::create_dir_all(&artifacts_dir_raw).expect("Failed to create dir"); let artifacts_dir_pathbuf = artifacts_dir_raw.canonicalize().unwrap(); let artifacts_dir = artifacts_dir_pathbuf.as_path();
    

    // ==========================================
    // PHASE 1: Downloader Resiliency Tests
    // ==========================================
    println!("[E2E Test] Starting ModelDownloader verification...");
    
    // We download a tiny public JSON file from Hugging Face for test validation
    let test_url = "https://huggingface.co/bert-base-uncased/resolve/main/config.json";
    let download_target = artifacts_dir.join("qwen_test_download.json");
    if download_target.exists() {
        let _ = fs::remove_file(&download_target);
    }

    // A. Sandbox Path Verification
    let invalid_path = Path::new("dummy/../escape_sandbox.json");
    let sandbox_res = ModelDownloader::validate_sandbox_path(&invalid_path);
    assert!(sandbox_res.is_err(), "Sandbox should prevent path traversal escaping the sandbox directory.");

    // B. Real Download and Telemetry Tracking
    let progress_called = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let progress_called_clone = progress_called.clone();
    let download_res = ModelDownloader::download_model(
        test_url,
        &download_target,
        None,
        Some(move |progress: f64| {
            progress_called_clone.store(true, std::sync::atomic::Ordering::SeqCst);
            assert!(progress >= 0.0 && progress <= 1.0, "Progress telemetry must be bounded [0.0, 1.0]");
        }),
    );

    assert!(download_res.is_ok(), "ModelDownloader failed to download: {:?}", download_res.err());
    assert!(download_target.exists(), "ModelDownloader succeeded but file was not created.");
    assert!(progress_called.load(std::sync::atomic::Ordering::SeqCst), "Telemetry progress callback was never executed.");

    // C. Expected SHA-256 Hash Check
    let actual_sha = ModelDownloader::compute_sha256(&download_target).expect("Failed to compute downloaded file hash");
    println!("[E2E Test] Computed SHA-256 for downloaded test file: {}", actual_sha);

    // Call download again with correct expected hash - should skip download instantly (we verify this does not crash)
    let skip_res = ModelDownloader::download_model(
        test_url,
        &download_target,
        Some(&actual_sha),
        None::<fn(f64)>,
    );
    assert!(skip_res.is_ok(), "Skipped download failed: {:?}", skip_res.err());

    // D. Range-Header Resume Verification
    let resume_target = artifacts_dir.join("qwen_resume_download.json");
    let resume_part = resume_target.with_extension("part");
    if resume_target.exists() {
        let _ = fs::remove_file(&resume_target);
    }
    if resume_part.exists() {
        let _ = fs::remove_file(&resume_part);
    }

    // Write a partial mock file representing interrupted download (first 5 bytes)
    fs::write(&resume_part, b"{\n  \"a").expect("Failed to write partial file");

    let resume_res = ModelDownloader::download_model(
        test_url,
        &resume_target,
        Some(&actual_sha),
        None::<fn(f64)>,
    );
    assert!(resume_res.is_ok(), "Range-header resume failed: {:?}", resume_res.err());
    assert!(resume_target.exists(), "Resumed file was not saved correctly.");
    assert!(!resume_part.exists(), "Resumed temporary .part file was not deleted upon success.");

    // E. SHA-256 Check Mismatch Rollback
    let fail_target = artifacts_dir.join("qwen_fail_download.json");
    let fail_part = fail_target.with_extension("part");
    if fail_target.exists() {
        let _ = fs::remove_file(&fail_target);
    }
    if fail_part.exists() {
        let _ = fs::remove_file(&fail_part);
    }

    let bad_sha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; // Empty hash
    let fail_res = ModelDownloader::download_model(
        test_url,
        &fail_target,
        Some(bad_sha),
        None::<fn(f64)>,
    );
    assert!(fail_res.is_err(), "Download should fail when SHA-256 hash mismatches.");
    assert!(!fail_target.exists(), "Target file should not exist after hash failure.");
    assert!(!fail_part.exists(), "Temporary .part file must be deleted (rolled back) to prevent corruption.");

    println!("[E2E Test] Model Downloader E2E completed.");
}
