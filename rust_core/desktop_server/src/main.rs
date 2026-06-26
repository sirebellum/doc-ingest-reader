use axum::{
    routing::{get, post},
    Router, Json, response::IntoResponse,
    http::{StatusCode, header},
};
use serde_json::{Value, json};
use parser::{RealPdfExtractor, MockPdfExtractor, PdfExtractor};
use std::sync::OnceLock;
use contracts::error::AppError;
use tower_http::cors::{CorsLayer, Any};

fn format_error(e: AppError) -> String {
    serde_json::to_string(&json!({ "error": e.to_string() }))
        .unwrap_or_else(|_| "{\"error\": \"Internal error serialization failed\"}".to_string())
}

fn format_string_error(e: &str) -> String {
    serde_json::to_string(&json!({ "error": e }))
        .unwrap_or_else(|_| "{\"error\": \"Internal error serialization failed\"}".to_string())
}

static TEST_DB_PATH: OnceLock<String> = OnceLock::new();

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut db_path = None;
    
    for i in 0..args.len() {
        if args[i] == "--db" && i + 1 < args.len() {
            db_path = Some(args[i + 1].clone());
        }
    }
    
    // Give environment variables precedence over the default CMake target arguments
    if let Ok(env_path) = std::env::var("SERVED_DB_PATH") {
        db_path = Some(env_path);
    } else if let Ok(env_path) = std::env::var("TEST_DB_PATH") {
        db_path = Some(env_path);
    }
    
    let resolved_path = db_path.unwrap_or_else(|| {
        let p1 = "test_artifacts/e2e_synthetic_validation/test_corpus.db";
        let p2 = "../test_artifacts/e2e_synthetic_validation/test_corpus.db";
        let p3 = "../../test_artifacts/e2e_synthetic_validation/test_corpus.db";
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

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/db", get(serve_db))
        .route("/assets/llm_pdf_reader.db", get(serve_db))
        .route("/parse", post(handle_parse))
        .route("/inference", post(handle_inference))
        .route("/delineate", post(handle_delineate))
        .route("/similarity", post(handle_similarity))
        .route("/batch-similarity", post(handle_batch_similarity))
        .layer(cors);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:8080").await.unwrap();
    println!("[Desktop Server] Running on http://127.0.0.1:8080");
    println!("[Desktop Server] CORS is enabled. Ready for browser React Native Expo Web UI calls!");

    axum::serve(listener, app).await.unwrap();
}

async fn serve_db() -> impl IntoResponse {
    let db_file_path = TEST_DB_PATH.get().cloned().unwrap_or_default();
    println!("[Desktop Server] Serving SQLite database from path: {}", db_file_path);
    
    match tokio::fs::read(&db_file_path).await {
        Ok(bytes) => {
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "application/x-sqlite3")],
                bytes,
            ).into_response()
        }
        Err(e) => {
            eprintln!("[Desktop Server] Failed to read database file: {}", e);
            let error_body = format!("{{\"error\":\"Failed to read database file: {}\"}}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                [(header::CONTENT_TYPE, "application/json")],
                error_body,
            ).into_response()
        }
    }
}

async fn handle_parse(Json(json_val): Json<Value>) -> impl IntoResponse {
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
                Err(e) => format_error(e),
            }
        }
        "html" | "htm" => {
            match parser::parse_html(&path) {
                Ok(json) => json,
                Err(e) => format_error(e),
            }
        }
        "epub" => {
            match parser::parse_epub(&path) {
                Ok(json) => json,
                Err(e) => format_error(e),
            }
        }
        "pdf" => {
            let doc_id = format!("doc-uuid-{}", parser::sha2_hash(&path));
            let extractor = RealPdfExtractor {
                document_id: doc_id.clone(),
                pdf_path: path.clone(),
            };
            
            match extractor.extract_page(page_number) {
                Ok(extraction) => serde_json::to_string(&extraction).unwrap_or_default(),
                Err(e) => {
                    eprintln!("[Desktop Server] Real PDF extractor failed, falling back to mock: {}", e);
                    let mock = MockPdfExtractor { document_id: doc_id };
                    match mock.extract_page(page_number) {
                        Ok(extraction) => serde_json::to_string(&extraction).unwrap_or_default(),
                        Err(me) => format_error(me),
                    }
                }
            }
        }
        _ => format!("{{\"error\":\"Unsupported format extension: '{}'\"}}", ext),
    };

    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        result_str,
    ).into_response()
}

async fn handle_inference(Json(json_val): Json<Value>) -> impl IntoResponse {
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
        Err(e) => format_error(e),
    };

    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        result_str,
    ).into_response()
}

async fn handle_delineate() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        [(header::CONTENT_TYPE, "application/json")],
        format_string_error("Endpoint removed"),
    ).into_response()
}

async fn handle_similarity(Json(json_val): Json<Value>) -> impl IntoResponse {
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

    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        response_str,
    ).into_response()
}

async fn handle_batch_similarity(Json(json_val): Json<Value>) -> impl IntoResponse {
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

    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        response_str,
    ).into_response()
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
