use agent_harness::tools::{AgentDatabases, AgentTool, QueryVectorDB, ReadContentDB, QueryAgentDB, CreateNode, LinkNodes, ParsingComplete, AskHuman, CreateTag};
use rusqlite::Connection;
use tempfile::NamedTempFile;
use dbs::manager::init_agent_db;
use serde_json::Value;

fn setup_test_dbs() -> (AgentDatabases, NamedTempFile, NamedTempFile) {
    let content_file = NamedTempFile::new().unwrap();
    let agent_file = NamedTempFile::new().unwrap();

    let content_db = Connection::open(content_file.path()).unwrap();
    let agent_db = Connection::open(agent_file.path()).unwrap();

    init_agent_db(&agent_db).unwrap();

    // Create table needed for migration tests
    content_db.execute(
        "CREATE TABLE IF NOT EXISTS sections (id TEXT PRIMARY KEY, document_id TEXT, parent_id TEXT, title TEXT, depth_level INTEGER, sort_order INTEGER)",
        []
    ).unwrap();

    let dbs = AgentDatabases {
        agent_db,
        content_db,
        agent_db_path: agent_file.path().to_string_lossy().to_string(),
        content_db_path: content_file.path().to_string_lossy().to_string(),
        document_id: "test_doc".to_string(),
    };

    dbs.agent_db.execute(
        "INSERT INTO corpora (id, name) VALUES ('corp1', 'test corp')", []
    ).unwrap();
    dbs.agent_db.execute(
        "INSERT INTO documents (id, corpus_id, title, sha256_hash, storage_path) VALUES ('test_doc', 'corp1', 'Title', 'hash', '/path')", []
    ).unwrap();

    (dbs, content_file, agent_file)
}

#[test]
fn test_query_vector_db() {
    let (dbs, _c, _a) = setup_test_dbs();
    dbs.agent_db.execute(
        "INSERT INTO pass1_chunks (id, document_id, raw_layout_text) VALUES ('chunk1', 'test_doc', 'hello world semantic search')",
        []
    ).unwrap();

    let tool = QueryVectorDB;
    let result = tool.execute(r#"{"query": "semantic"}"#, &dbs).unwrap();
    
    let parsed: Value = serde_json::from_str(&result).unwrap();
    let arr = parsed.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["id"], "chunk1");
}

#[test]
fn test_read_content_db() {
    let (dbs, _c, _a) = setup_test_dbs();
    dbs.agent_db.execute(
        "INSERT INTO pass1_chunks (id, document_id, raw_layout_text) VALUES ('chunk1', 'test_doc', 'specific text chunk')",
        []
    ).unwrap();

    let tool = ReadContentDB;
    let result = tool.execute(r#"{"chunk_id": "chunk1"}"#, &dbs).unwrap();
    
    let parsed: Value = serde_json::from_str(&result).unwrap();
    assert_eq!(parsed["id"], "chunk1");
    assert_eq!(parsed["text"], "specific text chunk");
}

#[test]
fn test_query_agent_db() {
    let (dbs, _c, _a) = setup_test_dbs();
    let tool = QueryAgentDB;
    
    // Test Insert
    let insert_res = tool.execute(r#"{"sql": "INSERT INTO tags (id, name, source) VALUES ('tag1', 'test_tag', 'user')"}"#, &dbs).unwrap();
    assert!(insert_res.contains("success"));
    
    // Test Select
    let select_res = tool.execute(r#"{"sql": "SELECT id, name FROM tags"}"#, &dbs).unwrap();
    let parsed: Value = serde_json::from_str(&select_res).unwrap();
    let arr = parsed.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["id"], "tag1");
    assert_eq!(arr[0]["name"], "test_tag");
}

#[test]
fn test_create_node_section() {
    let (dbs, _c, _a) = setup_test_dbs();
    let tool = CreateNode;
    
    let args = r#"{
        "type": "section",
        "id": "sec1",
        "title": "Introduction \"and\" \n \\ backslashes",
        "depth_level": 1,
        "sort_order": 0
    }"#;
    
    let res = tool.execute(args, &dbs).unwrap();
    let parsed: Value = serde_json::from_str(&res).unwrap();
    assert_eq!(parsed["status"], "success");
    
    let count: i64 = dbs.agent_db.query_row("SELECT count(*) FROM sections WHERE id = 'sec1'", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 1);
}

#[test]
fn test_create_node_block() {
    let (dbs, _c, _a) = setup_test_dbs();
    
    dbs.agent_db.execute(
        "INSERT INTO sections (id, document_id, title, depth_level, sort_order) VALUES ('sec1', 'test_doc', 'Title', 1, 0)", []
    ).unwrap();

    let tool = CreateNode;
    
    let args = r#"{
        "type": "block",
        "id": "blk1",
        "section_id": "sec1",
        "block_type": "paragraph",
        "content": "some text with \"quotes\" \n and \\ backslashes"
    }"#;
    
    let res = tool.execute(args, &dbs).unwrap();
    let parsed: Value = serde_json::from_str(&res).unwrap();
    assert_eq!(parsed["status"], "success");
    
    let count: i64 = dbs.agent_db.query_row("SELECT count(*) FROM blocks WHERE id = 'blk1'", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 1);
}

#[test]
fn test_link_nodes() {
    let (dbs, _c, _a) = setup_test_dbs();
    
    dbs.agent_db.execute(
        "INSERT INTO sections (id, document_id, title, depth_level, sort_order) VALUES ('sec1', 'test_doc', 'Title', 1, 0)", []
    ).unwrap();
    dbs.agent_db.execute(
        "INSERT INTO blocks (id, section_id, document_id, content, sort_order) VALUES ('blk1', 'sec1', 'test_doc', 'content', 0)", []
    ).unwrap();
    dbs.agent_db.execute(
        "INSERT INTO tags (id, name, source) VALUES ('tag1\n\"\\', 'test_tag', 'user')", []
    ).unwrap();

    let tool = LinkNodes;
    
    let args = r#"{
        "block_id": "blk1",
        "tag_id": "tag1\n\"\\"
    }"#;
    
    let res = tool.execute(args, &dbs).unwrap();
    let parsed: Value = serde_json::from_str(&res).unwrap();
    assert_eq!(parsed["status"], "success");
    
    let count: i64 = dbs.agent_db.query_row("SELECT count(*) FROM block_tags WHERE block_id = 'blk1'", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 1);
}

#[test]
fn test_parsing_complete() {
    let (dbs, _c, _a) = setup_test_dbs();
    let tool = ParsingComplete;
    let res = tool.execute("{}", &dbs).unwrap();
    assert!(res.contains("Parsing Complete Triggered"));
}

#[test]
fn test_ask_human() {
    let (dbs, _c, _a) = setup_test_dbs();
    let tool = AskHuman;
    let res = tool.execute(r#"{"question": "What happens if I type \"this\" \n and \\?"}"#, &dbs).unwrap();
    let parsed: Value = serde_json::from_str(&res).unwrap();
    assert_eq!(parsed["status"], "Waiting for human");
    assert_eq!(parsed["question"], "What happens if I type \"this\" \n and \\?");
}

#[test]
fn test_create_tag() {
    let (dbs, _c, _a) = setup_test_dbs();
    let tool = CreateTag;

    let args = r#"{
        "id": "tag_test_1",
        "name": "New Awesome Tag"
    }"#;

    let res = tool.execute(args, &dbs).unwrap();
    let parsed: Value = serde_json::from_str(&res).unwrap();
    assert_eq!(parsed["status"], "success");
    assert_eq!(parsed["created_tag_id"], "tag_test_1");
    
    let count: i64 = dbs.agent_db.query_row("SELECT count(*) FROM tags WHERE id = 'tag_test_1' AND source = 'agent'", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 1);
}
