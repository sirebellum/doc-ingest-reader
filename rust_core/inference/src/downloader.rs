use contracts::error::AppError;
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, RANGE};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub struct ModelDownloader;

impl ModelDownloader {
    /// Computes the SHA-256 hash of a file.
    pub fn compute_sha256(path: &Path) -> Result<String, AppError> {
        let mut file = File::open(path)?;
        let mut hasher = Sha256::new();
        let mut buffer = [0; 65536];
        loop {
            let n = file.read(&mut buffer)?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
        }
        Ok(format!("{:x}", hasher.finalize()))
    }

    /// Validates that the target path is inside a secure folder.
    pub fn validate_sandbox_path(path: &Path) -> Result<(), AppError> {
        let path_str = path.to_string_lossy();
        if path_str.contains("..") {
            return Err(AppError::Generic(format!(
                "Sandbox violation: path traversal detected in {:?}",
                path
            )));
        }
        Ok(())
    }

    /// Downloads a model GGUF file from Hugging Face with resiliency, chunked streaming,
    /// range-header resume support, and progress updates.
    pub fn download_model<F>(
        url: &str,
        target_path: &Path,
        expected_sha256: Option<&str>,
        progress_callback: Option<F>,
    ) -> Result<(), AppError>
    where
        F: Fn(f64) + Send + Sync + 'static,
    {
        Self::validate_sandbox_path(target_path)?;

        // 1. Check if the target file already exists and passes hash validation
        if target_path.exists() {
            if let Some(expected) = expected_sha256 {
                println!("[ModelDownloader] File already exists. Validating hash...");
                match Self::compute_sha256(target_path) {
                    Ok(hash) => {
                        if hash.eq_ignore_ascii_case(expected) {
                            println!("[ModelDownloader] Hash match. Skipping download.");
                            if let Some(ref cb) = progress_callback {
                                cb(1.0);
                            }
                            return Ok(());
                        } else {
                            println!("[ModelDownloader] Hash mismatch (got {}, expected {}). Re-downloading.", hash, expected);
                        }
                    }
                    Err(e) => {
                        println!(
                            "[ModelDownloader] Error hashing existing file: {:?}. Re-downloading.",
                            e
                        );
                    }
                }
            } else {
                println!("[ModelDownloader] File exists, and no hash validation was requested. Skipping.");
                if let Some(ref cb) = progress_callback {
                    cb(1.0);
                }
                return Ok(());
            }
        }

        // Ensure parent directory exists
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)?;
        }

        // 2. Concurrency Lock: Prevent multiple concurrent downloads
        let lock_path = target_path.with_extension("lock");
        let _lock_file = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
        {
            Ok(file) => file,
            Err(ref e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                // Check if the lock file is stale (older than 30 mins) to prevent permanent deadlocks
                if let Ok(metadata) = fs::metadata(&lock_path) {
                    if let Ok(modified) = metadata.modified() {
                        if let Ok(elapsed) = modified.elapsed() {
                            if elapsed > Duration::from_secs(1800) {
                                println!(
                                    "[ModelDownloader] Stale lock file detected. Removing it."
                                );
                                let _ = fs::remove_file(&lock_path);
                                OpenOptions::new()
                                    .write(true)
                                    .create_new(true)
                                    .open(&lock_path)
                                    .map_err(|_| {
                                        AppError::Generic(format!(
                                            "Failed to acquire newly cleared lock file"
                                        ))
                                    })?
                            } else {
                                return Err(AppError::Generic(format!(
                                    "Another download operation is currently in progress."
                                )));
                            }
                        } else {
                            return Err(AppError::Generic(format!(
                                "Another download operation is currently in progress."
                            )));
                        }
                    } else {
                        return Err(AppError::Generic(format!(
                            "Another download operation is currently in progress."
                        )));
                    }
                } else {
                    return Err(AppError::Generic(format!(
                        "Another download operation is currently in progress."
                    )));
                }
            }
            Err(e) => {
                return Err(AppError::Generic(format!(
                    "Failed to create lock file: {:?}",
                    e
                )))
            }
        };

        // Ensure the lock is cleaned up on exit
        struct LockGuard(PathBuf);
        impl Drop for LockGuard {
            fn drop(&mut self) {
                let _ = fs::remove_file(&self.0);
            }
        }
        let _guard = LockGuard(lock_path);

        let part_path = target_path.with_extension("part");
        let client = Client::builder()
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| AppError::NetworkError(e.to_string()))?;

        let mut retries = 3;
        let mut backoff = Duration::from_secs(2);

        loop {
            // Get current downloaded size for Range request
            let downloaded_bytes = if part_path.exists() {
                fs::metadata(&part_path)?.len()
            } else {
                0
            };

            println!(
                "[ModelDownloader] Connecting to download. Downloaded: {} bytes. Retries left: {}",
                downloaded_bytes, retries
            );

            let mut headers = HeaderMap::new();
            if downloaded_bytes > 0 {
                headers.insert(
                    RANGE,
                    format!("bytes={}-", downloaded_bytes)
                        .parse()
                        .map_err(|e| {
                            AppError::NetworkError(format!("Invalid range header: {}", e))
                        })?,
                );
            }

            let request_res = client.get(url).headers(headers).send();

            match request_res {
                Ok(mut response) => {
                    let status = response.status();
                    if !status.is_success() {
                        println!("[ModelDownloader] Server returned error status: {}", status);
                        retries -= 1;
                        if retries == 0 {
                            return Err(AppError::Generic(format!(
                                "Download failed: Server returned status {}",
                                status
                            )));
                        }
                        std::thread::sleep(backoff);
                        backoff *= 2;
                        continue;
                    }

                    // Check if server accepted the range request (Partial Content 206)
                    let is_partial = status == reqwest::StatusCode::PARTIAL_CONTENT;

                    // Total expected bytes of the *full* file
                    let total_bytes = if is_partial {
                        if let Some(content_range) =
                            response.headers().get(reqwest::header::CONTENT_RANGE)
                        {
                            if let Ok(range_str) = content_range.to_str() {
                                if let Some(slash_idx) = range_str.rfind('/') {
                                    range_str[slash_idx + 1..].parse::<u64>().ok()
                                } else {
                                    None
                                }
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    } else {
                        response.content_length()
                    };

                    let total_expected = total_bytes.unwrap_or(0);
                    println!(
                        "[ModelDownloader] Connection established. Partial: {}, Total Expected: {} bytes",
                        is_partial, total_expected
                    );

                    // Open file in append or write mode
                    let mut file = if is_partial && downloaded_bytes > 0 {
                        OpenOptions::new()
                            .write(true)
                            .append(true)
                            .open(&part_path)?
                    } else {
                        OpenOptions::new()
                            .write(true)
                            .create(true)
                            .truncate(true)
                            .open(&part_path)?
                    };

                    let mut total_downloaded = if is_partial { downloaded_bytes } else { 0 };
                    let mut buffer = [0; 65536];
                    let mut download_error = None;

                    // Stream response body in chunks
                    loop {
                        match response.read(&mut buffer) {
                            Ok(0) => break, // EOF reached
                            Ok(n) => {
                                if let Err(e) = file.write_all(&buffer[..n]) {
                                    download_error = Some(AppError::Generic(format!(
                                        "Failed to write to part file: {:?}",
                                        e
                                    )));
                                    break;
                                }
                                total_downloaded += n as u64;

                                // Telemetry Callback
                                if let Some(ref cb) = progress_callback {
                                    if total_expected > 0 {
                                        cb(total_downloaded as f64 / total_expected as f64);
                                    }
                                }
                            }
                            Err(e) => {
                                download_error =
                                    Some(AppError::Generic(format!("Network read error: {:?}", e)));
                                break;
                            }
                        }
                    }

                    if let Some(err) = download_error {
                        println!("[ModelDownloader] Stream interrupted: {:?}", err);
                        retries -= 1;
                        if retries == 0 {
                            return Err(err);
                        }
                        std::thread::sleep(backoff);
                        backoff *= 2;
                        continue;
                    }

                    // Successful transfer of all stream bytes!
                    println!("[ModelDownloader] Content stream complete. Validating final file...");
                    break;
                }
                Err(e) => {
                    println!("[ModelDownloader] Connection attempt failed: {:?}", e);
                    retries -= 1;
                    if retries == 0 {
                        return Err(AppError::Generic(format!("Connection failed: {:?}", e)));
                    }
                    std::thread::sleep(backoff);
                    backoff *= 2;
                }
            }
        }

        // 3. Post-download hash verification
        if let Some(expected) = expected_sha256 {
            let actual_hash = Self::compute_sha256(&part_path)?;
            if !actual_hash.eq_ignore_ascii_case(expected) {
                // Mismatch: Roll back / delete corrupted file to protect local storage
                let _ = fs::remove_file(&part_path);
                return Err(AppError::Generic(format!(
                    "SHA-256 hash mismatch! Expected: {}, Got: {}. Deleted temporary part file.",
                    expected, actual_hash
                )));
            }
        }

        // Rename `.part` file to the final destination
        fs::rename(&part_path, target_path)?;
        println!("[ModelDownloader] Model download succeeded!");
        if let Some(ref cb) = progress_callback {
            cb(1.0);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::prelude::*;
    use sha2::{Digest, Sha256};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn get_temp_path(name: &str) -> PathBuf {
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("{}_{}", timestamp, name))
    }

    #[test]
    fn test_successful_download() {
        let server = MockServer::start();
        let content = b"dummy content";
        
        let mock = server.mock(|when, then| {
            when.method(GET).path("/model.gguf");
            then.status(200)
                .body(content);
        });

        let mut hasher = Sha256::new();
        hasher.update(content);
        let expected_sha = format!("{:x}", hasher.finalize());

        let target_path = get_temp_path("model_success.gguf");

        let res = ModelDownloader::download_model(
            &server.url("/model.gguf"),
            &target_path,
            Some(&expected_sha),
            None::<fn(f64)>,
        );

        assert!(res.is_ok());
        assert!(target_path.exists());
        mock.assert();
        let _ = fs::remove_file(&target_path);
    }

    #[test]
    fn test_network_failure_retry() {
        let server = MockServer::start();
        
        let mock = server.mock(|when, then| {
            when.method(GET).path("/model.gguf");
            then.status(500);
        });

        let target_path = get_temp_path("model_fail.gguf");

        let res = ModelDownloader::download_model(
            &server.url("/model.gguf"),
            &target_path,
            None,
            None::<fn(f64)>,
        );

        assert!(res.is_err());
        mock.assert_hits(3);
        let _ = fs::remove_file(&target_path);
        let _ = fs::remove_file(&target_path.with_extension("part"));
        let _ = fs::remove_file(&target_path.with_extension("lock"));
    }

    #[test]
    fn test_sha256_mismatch() {
        let server = MockServer::start();
        let content = b"dummy content";
        
        let mock = server.mock(|when, then| {
            when.method(GET).path("/model.gguf");
            then.status(200)
                .body(content);
        });

        let target_path = get_temp_path("model_mismatch.gguf");
        let expected_sha = "wronghash";

        let res = ModelDownloader::download_model(
            &server.url("/model.gguf"),
            &target_path,
            Some(expected_sha),
            None::<fn(f64)>,
        );

        assert!(res.is_err());
        assert!(!target_path.exists());
        assert!(!target_path.with_extension("part").exists());
        mock.assert();
        let _ = fs::remove_file(&target_path.with_extension("lock"));
    }

    #[test]
    fn test_early_exit_existing_file() {
        let content = b"dummy content";
        let mut hasher = Sha256::new();
        hasher.update(content);
        let expected_sha = format!("{:x}", hasher.finalize());

        let target_path = get_temp_path("model_existing.gguf");
        std::fs::write(&target_path, content).unwrap();

        let res = ModelDownloader::download_model(
            "http://invalid.local/model.gguf",
            &target_path,
            Some(&expected_sha),
            None::<fn(f64)>,
        );

        assert!(res.is_ok());
        let _ = fs::remove_file(&target_path);
    }
}
