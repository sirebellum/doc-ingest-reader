use agent_harness::agent::{AgentState, AgentStatus};
use agent_harness::tools::AgentDatabases;
use rusqlite::Connection;
use tempfile::NamedTempFile;
use dbs::manager::init_agent_db;

fn setup_test_state() -> (AgentState, NamedTempFile, NamedTempFile) {
    let content_file = NamedTempFile::new().unwrap();
    let agent_file = NamedTempFile::new().unwrap();

    let content_db = Connection::open(content_file.path()).unwrap();
    let agent_db = Connection::open(agent_file.path()).unwrap();

    // Initialize schema for agent_db
    init_agent_db(&agent_db).unwrap();

    // Create tables needed for migration tests
    content_db.execute_batch(dbs::schema::INITIALIZE_DATABASE_SCHEMA).unwrap();

    let dbs = AgentDatabases {
        agent_db,
        content_db,
        agent_db_path: agent_file.path().to_string_lossy().to_string(),
        content_db_path: content_file.path().to_string_lossy().to_string(),
        document_id: "test_doc_123".to_string(),
    };

    let state = AgentState::new(dbs).unwrap();
    (state, content_file, agent_file)
}

#[test]
fn test_agent_initialization() {
    let (state, _c, _a) = setup_test_state();
    assert_eq!(state.status, AgentStatus::Running);
    assert_eq!(state.failed_tool_calls, 0);

    // Check history
    let count: i64 = state.databases.agent_db.query_row(
        "SELECT count(*) FROM conversation_history WHERE session_id = 'session_1'",
        [],
        |row| row.get(0)
    ).unwrap();
    assert_eq!(count, 1, "Agent initialized should append to history");
}

#[test]
fn test_agent_successful_tool_call() {
    let (mut state, _c, _a) = setup_test_state();
    state.inference_override = Some(|_prompt| {
        Ok(r#"{"tool": "AskHuman", "args": {"question": "Hello?"}}"#.to_string())
    });

    let status = state.step().unwrap();
    assert_eq!(status, AgentStatus::WaitingForHuman(r#"{"question":"Hello?"}"#.to_string()));
    assert_eq!(state.status, AgentStatus::WaitingForHuman(r#"{"question":"Hello?"}"#.to_string()));
    assert_eq!(state.failed_tool_calls, 0);
}

#[test]
fn test_agent_malformed_json() {
    let (mut state, _c, _a) = setup_test_state();
    state.inference_override = Some(|_prompt| {
        Ok(r#"{"tool": "AskHuman" args: {"question": "Missing comma and colon"}}"#.to_string()) // Missing comma and quotes
    });

    let status = state.step().unwrap();
    assert_eq!(status, AgentStatus::Running);
    assert_eq!(state.failed_tool_calls, 1);

    // Verify malformed blocks log
    let count: i64 = state.databases.agent_db.query_row(
        "SELECT count(*) FROM malformed_blocks WHERE document_id = 'test_doc_123'",
        [],
        |row| row.get(0)
    ).unwrap();
    assert_eq!(count, 1, "Should log malformed block");
}

#[test]
fn test_agent_no_json() {
    let (mut state, _c, _a) = setup_test_state();
    state.inference_override = Some(|_prompt| {
        Ok("Just plain text with no json".to_string())
    });

    let status = state.step().unwrap();
    assert_eq!(status, AgentStatus::Running);
    assert_eq!(state.failed_tool_calls, 1);
}

#[test]
fn test_agent_consecutive_failures_pause() {
    let (mut state, _c, _a) = setup_test_state();
    state.inference_override = Some(|_prompt| {
        Ok("Garbage output".to_string())
    });

    // 1st failure
    state.step().unwrap();
    assert_eq!(state.failed_tool_calls, 1);

    // 2nd failure
    state.step().unwrap();
    assert_eq!(state.failed_tool_calls, 2);

    // 3rd failure -> changes state to WaitingForHuman
    let status = state.step().unwrap();
    assert!(matches!(status, AgentStatus::WaitingForHuman(_)));
    assert_eq!(state.failed_tool_calls, 3);
}

#[test]
fn test_parsing_complete_completes_agent() {
    let (mut state, _c, _a) = setup_test_state();
    state.inference_override = Some(|_prompt| {
        Ok(r#"{"tool": "ParsingComplete", "args": {}}"#.to_string())
    });

    let status = state.step().unwrap();
    assert_eq!(status, AgentStatus::Completed);
    assert_eq!(state.status, AgentStatus::Completed);
}

#[test]
fn test_parsing_complete_migration_failure() {
    let (mut state, _c, _a) = setup_test_state();
    
    // Corrupt the content DB path to force a migration failure
    state.databases.content_db_path = "/invalid/path/that/does/not/exist.db".to_string();

    state.inference_override = Some(|_prompt| {
        Ok(r#"{"tool": "ParsingComplete", "args": {}}"#.to_string())
    });

    let status = state.step().unwrap();
    assert!(matches!(status, AgentStatus::Error(_)));
    assert!(matches!(state.status, AgentStatus::Error(_)));
}

#[test]
fn test_agent_inference_failure() {
    let (mut state, _c, _a) = setup_test_state();
    
    state.inference_override = Some(|_prompt| {
        Err(contracts::error::AppError::Generic("Simulated model failure".to_string()))
    });

    let status = state.step().unwrap();
    assert!(matches!(status, AgentStatus::WaitingForHuman(ref s) if s.contains("Simulated model failure")));
}

#[test]
fn test_agent_unknown_tool() {
    let (mut state, _c, _a) = setup_test_state();
    
    state.inference_override = Some(|_prompt| {
        Ok(r#"{"tool": "MakeMeSandwich", "args": {}}"#.to_string())
    });

    let status = state.step().unwrap();
    assert_eq!(status, AgentStatus::Running);
    assert_eq!(state.failed_tool_calls, 1);
}

#[test]
fn test_agent_tool_execution_failure() {
    let (mut state, _c, _a) = setup_test_state();
    
    state.inference_override = Some(|_prompt| {
        Ok(r#"{"tool": "QueryAgentDB", "args": {"query": "SELECT * FROM definitely_not_a_table"}}"#.to_string())
    });

    let status = state.step().unwrap();
    assert_eq!(status, AgentStatus::Running);
    assert_eq!(state.failed_tool_calls, 1);
}
