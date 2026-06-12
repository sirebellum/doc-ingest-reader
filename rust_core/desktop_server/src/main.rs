use tiny_http::{Server, Request, Response, Header};
use serde_json::Value;
use parser::{RealPdfExtractor, MockPdfExtractor, PdfExtractor};
use std::sync::OnceLock;

static TEST_DB_PATH: OnceLock<String> = OnceLock::new();

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut db_path = std::env::var("TEST_DB_PATH").ok();
    
    for i in 0..args.len() {
        if args[i] == "--db" && i + 1 < args.len() {
            db_path = Some(args[i + 1].clone());
        }
    }
    
    let resolved_path = db_path.unwrap_or_else(|| {
        let p1 = "test_artifacts/test_dbs/e2e_integration/test_corpus.db";
        let p2 = "../test_artifacts/test_dbs/e2e_integration/test_corpus.db";
        let p3 = "../../test_artifacts/test_dbs/e2e_integration/test_corpus.db";
        let p4 = "parser/target/test_artifacts/test_corpus.db";
        if std::path::Path::new(p1).exists() {
            p1.to_string()
        } else if std::path::Path::new(p2).exists() {
            p2.to_string()
        } else if std::path::Path::new(p3).exists() {
            p3.to_string()
        } else {
            p4.to_string()
        }
    });
    
    let _ = TEST_DB_PATH.set(resolved_path.clone());
    println!("[Desktop Server] Active SQLite Test Database Path: {}", resolved_path);

    let server = Server::http("127.0.0.1:8080").expect("Failed to bind to 127.0.0.1:8080");
    println!("[Desktop Server] Running on http://127.0.0.1:8080");
    println!("[Desktop Server] CORS is enabled. Ready for browser React Native Expo Web UI calls!");


    for request in server.incoming_requests() {
        handle_request(request);
    }
}

fn handle_request(mut request: Request) {
    let method_str = request.method().as_str().to_string();
    let method = method_str.as_str();
    let url = request.url().to_string();
    
    println!("[Desktop Server] Received {} {}", method, url);

    // Common CORS headers
    let cors_origin = Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap();
    let cors_methods = Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"POST, GET, OPTIONS"[..]).unwrap();
    let cors_headers = Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Content-Type"[..]).unwrap();

    let response_headers = vec![
        cors_origin.clone(),
        cors_methods.clone(),
        cors_headers.clone()
    ];

    // Handle preflight OPTIONS request
    if method == "OPTIONS" {
        let mut response = Response::empty(204);
        for h in response_headers {
            response = response.with_header(h);
        }
        let _ = request.respond(response);
        return;
    }

    let mut body = Vec::new();
    if let Err(e) = request.as_reader().read_to_end(&mut body) {
        eprintln!("[Desktop Server] Failed to read request body: {}", e);
        let mut response = Response::from_string("{\"error\":\"Failed to read request body\"}")
            .with_status_code(400);
        for h in response_headers {
            response = response.with_header(h);
        }
        let _ = request.respond(response);
        return;
    }

    let json_val: Value = match serde_json::from_slice(&body) {
        Ok(val) => val,
        Err(_) if method == "POST" => {
            let mut response = Response::from_string("{\"error\":\"Invalid JSON body\"}")
                .with_status_code(400);
            for h in response_headers {
                response = response.with_header(h);
            }
            let _ = request.respond(response);
            return;
        }
        _ => Value::Null,
    };

    let mut response = match (method, url.as_str()) {
        ("GET", "/assets/llm_pdf_reader.db") | ("GET", "/db") => {
            let db_file_path = TEST_DB_PATH.get().cloned().unwrap_or_default();
            println!("[Desktop Server] Serving SQLite database from path: {}", db_file_path);
            
            // TODO (Architecture-Audit): [Delineator-Test] - Reading the SQLite database file synchronously blocks the single-threaded request loop. Consider streaming or using an async runtime to mitigate blocking under concurrent test access.
            match std::fs::read(&db_file_path) {
                Ok(bytes) => {
                    let mut res = Response::from_data(bytes)
                        .with_status_code(200);
                    let content_type = Header::from_bytes(&b"Content-Type"[..], &b"application/x-sqlite3"[..]).unwrap();
                    res = res.with_header(content_type);
                    res
                }
                Err(e) => {
                    eprintln!("[Desktop Server] Failed to read database file: {}", e);
                    let mut res = Response::from_string(format!("{{\"error\":\"Failed to read database file: {}\"}}", e))
                        .with_status_code(500);
                    let content_type = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
                    res = res.with_header(content_type);
                    res
                }
            }
        }
        ("POST", "/parse") => {
            let path = json_val["path"].as_str().unwrap_or("").to_string();
            let page_number = json_val["page_number"].as_u64().unwrap_or(1) as u32;

            println!("[Desktop Server] Parsing file: '{}' Page: {}", path, page_number);

            let ext = std::path::Path::new(&path)
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();

            let result_str = match ext.as_str() {
                "md" | "markdown" => {
                    match parser::parse_markdown(&path) {
                        Ok(json) => json,
                        Err(e) => format!("{{\"error\":\"Markdown parsing failed: {}\"}}", e),
                    }
                }
                "html" | "htm" => {
                    match parser::parse_html(&path) {
                        Ok(json) => json,
                        Err(e) => format!("{{\"error\":\"HTML parsing failed: {}\"}}", e),
                    }
                }
                "epub" => {
                    match parser::parse_epub(&path) {
                        Ok(json) => json,
                        Err(e) => format!("{{\"error\":\"EPUB parsing failed: {}\"}}", e),
                    }
                }
                "pdf" => {
                    let doc_id = format!("doc-uuid-{}", parser::sha2_hash(&path));
                    let extractor = RealPdfExtractor {
                        document_id: doc_id.clone(),
                        pdf_path: path.clone(),
                    };
                    
                    // Try real extractor (pdfium-render), fallback to mock if PDFium is missing
                    match extractor.extract_page(page_number) {
                        Ok(extraction) => serde_json::to_string(&extraction).unwrap_or_default(),
                        Err(e) => {
                            eprintln!("[Desktop Server] Real PDF extractor failed, falling back to mock: {}", e);
                            let mock = MockPdfExtractor { document_id: doc_id };
                            match mock.extract_page(page_number) {
                                Ok(extraction) => serde_json::to_string(&extraction).unwrap_or_default(),
                                Err(me) => format!("{{\"error\":\"PDF Mock extraction failed: {}\"}}", me),
                            }
                        }
                    }
                }
                _ => format!("{{\"error\":\"Unsupported format extension: '{}'\"}}", ext),
            };

            let mut res = Response::from_string(result_str)
                .with_status_code(200);
            
            let content_type = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
            res = res.with_header(content_type);
            res
        }

        ("POST", "/inference") => {
            let model_path = json_val["model_path"].as_str().unwrap_or("").to_string();
            let prompt = json_val["prompt"].as_str().unwrap_or("").to_string();

            println!("[Desktop Server] Running inference. Prompt length: {}", prompt.len());

            if !model_path.is_empty() {
                if let Err(e) = inference::initialize_inference_context(&model_path) {
                    eprintln!("[Desktop Server] Context initialization failed: {}", e);
                }
            }

            let result_str = match inference::run_local_inference(&prompt) {
                Ok(res) => res,
                Err(e) => format!("{{\"error\":\"Local inference execution failed: {}\"}}", e),
            };

            let mut res = Response::from_string(result_str)
                .with_status_code(200);

            let content_type = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
            res = res.with_header(content_type);
            res
        }

        ("POST", "/delineate") => {
            let mut res = Response::from_string("{\"error\":\"Endpoint removed\"}").with_status_code(404);
            let content_type = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
            res = res.with_header(content_type);
            res
        }

        ("POST", "/similarity") => {
            let vec_a: Vec<f32> = json_val["vec_a"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .map(|v| v.as_f64().unwrap_or(0.0) as f32)
                .collect();

            let vec_b: Vec<f32> = json_val["vec_b"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .map(|v| v.as_f64().unwrap_or(0.0) as f32)
                .collect();

            let sim = cosine_similarity(&vec_a, &vec_b);
            let response_str = format!("{{\"similarity\":{}}}", sim);

            let mut res = Response::from_string(response_str)
                .with_status_code(200);

            let content_type = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
            res = res.with_header(content_type);
            res
        }

        ("POST", "/batch-similarity") => {
            let target_vec: Vec<f32> = json_val["target_vec"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .map(|v| v.as_f64().unwrap_or(0.0) as f32)
                .collect();

            let candidates_arr = json_val["candidate_vecs"].as_array();
            let mut similarities = Vec::new();

            if let Some(candidates) = candidates_arr {
                for cand in candidates {
                    let cand_vec: Vec<f32> = cand
                        .as_array()
                        .unwrap_or(&vec![])
                        .iter()
                        .map(|v| v.as_f64().unwrap_or(0.0) as f32)
                        .collect();
                    similarities.push(cosine_similarity(&target_vec, &cand_vec));
                }
            }

            let response_str = format!("{{\"similarities\":{:?}}}", similarities);

            let mut res = Response::from_string(response_str)
                .with_status_code(200);

            let content_type = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
            res = res.with_header(content_type);
            res
        }

        _ => {
            Response::from_string("{\"error\":\"Endpoint not found\"}")
                .with_status_code(404)
        }
    };

    // Apply CORS headers to all route responses
    for h in response_headers {
        response = response.with_header(h);
    }

    let _ = request.respond(response);
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.is_empty() || b.is_empty() || a.len() != b.len() {
        return 0.0;
    }
    let mut dot_product = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;

    for i in 0..a.len() {
        let x = a[i];
        let y = b[i];
        dot_product += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }

    if norm_a == 0.0 || norm_b == 0.0 {
        0.0
    } else {
        dot_product / (norm_a.sqrt() * norm_b.sqrt())
    }
}
