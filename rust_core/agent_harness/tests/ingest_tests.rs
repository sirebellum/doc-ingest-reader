use agent_harness::ingest::{ingest_chunk_to_agent_db, agent_ingest_ffi};
use contracts::ExtractionChunk;
use dbs::manager::init_agent_db;
use rusqlite::Connection;
use std::ffi::CString;
use std::os::raw::c_void;

fn setup_db() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    init_agent_db(&db).unwrap();
    db
}

#[test]
fn test_ingest_chunk_standard() {
    let db = setup_db();
    let extraction = ExtractionChunk {
        chunk_index: 0,
        document_id: "doc1".to_string(),
        raw_text: "This is a short paragraph.\n\nThis is another short paragraph.".to_string(),
    };

    ingest_chunk_to_agent_db(&db, &extraction).unwrap();

    let count: i64 = db.query_row(
        "SELECT count(*) FROM pass1_chunks WHERE document_id = 'doc1'",
        [],
        |row| row.get(0),
    ).unwrap();
    
    assert_eq!(count, 1, "Should fit into a single block");
}

#[test]
fn test_ingest_chunk_large_paragraph() {
    let db = setup_db();
    let mut large_paragraph = String::new();
    for _ in 0..200 {
        large_paragraph.push_str("Word ");
    }
    large_paragraph.push_str(". ");
    for _ in 0..200 {
        large_paragraph.push_str("Word ");
    }
    large_paragraph.push_str(".");

    let extraction = ExtractionChunk {
        chunk_index: 1,
        document_id: "doc2".to_string(),
        raw_text: large_paragraph,
    };

    ingest_chunk_to_agent_db(&db, &extraction).unwrap();

    let count: i64 = db.query_row(
        "SELECT count(*) FROM pass1_chunks WHERE document_id = 'doc2'",
        [],
        |row| row.get(0),
    ).unwrap();
    
    assert!(count > 1, "Large paragraph should be split into multiple blocks");
}

#[test]
fn test_ingest_chunk_extreme_sentence() {
    let db = setup_db();
    let mut huge_sentence = String::new();
    for _ in 0..200 {
        huge_sentence.push_str("Word ");
    }

    let extraction = ExtractionChunk {
        chunk_index: 2,
        document_id: "doc3".to_string(),
        raw_text: huge_sentence,
    };

    ingest_chunk_to_agent_db(&db, &extraction).unwrap();

    let count: i64 = db.query_row(
        "SELECT count(*) FROM pass1_chunks WHERE document_id = 'doc3'",
        [],
        |row| row.get(0),
    ).unwrap();
    
    assert_eq!(count, 1, "Cannot split a single huge sentence, should be 1 block");
}

#[test]
fn test_agent_ingest_ffi_null_pointers() {
    let db = setup_db();
    let db_ptr = &db as *const _ as *mut c_void;
    
    let res1 = agent_ingest_ffi(std::ptr::null_mut(), std::ptr::null());
    assert_eq!(res1, -1);
    
    let res2 = agent_ingest_ffi(db_ptr, std::ptr::null());
    assert_eq!(res2, -1);
}

#[test]
fn test_agent_ingest_ffi_invalid_json() {
    let db = setup_db();
    let db_ptr = &db as *const _ as *mut c_void;
    
    let bad_json = CString::new("{ not valid json").unwrap();
    let res = agent_ingest_ffi(db_ptr, bad_json.as_ptr());
    
    assert_eq!(res, -3, "Should fail JSON parsing");
}

#[test]
fn test_agent_ingest_ffi_success() {
    let db = setup_db();
    let db_ptr = &db as *const _ as *mut c_void;
    
    let valid_json = CString::new(r#"{
        "chunk_index": 5,
        "document_id": "ffi_doc",
        "raw_text": "Hello FFI world."
    }"#).unwrap();
    
    let res = agent_ingest_ffi(db_ptr, valid_json.as_ptr());
    assert_eq!(res, 0, "Should succeed");
    
    let count: i64 = db.query_row(
        "SELECT count(*) FROM pass1_chunks WHERE document_id = 'ffi_doc'",
        [],
        |row| row.get(0),
    ).unwrap();
    assert_eq!(count, 1);
}
