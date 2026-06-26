use dbs::DatabaseManager;
use rusqlite::Connection;
use std::path::Path;

pub fn setup_test_databases(content_db_path: &Path, agent_db_path: &Path) {
    if content_db_path.exists() {
        std::fs::remove_file(content_db_path).unwrap();
    }
    if agent_db_path.exists() {
        std::fs::remove_file(agent_db_path).unwrap();
    }

    // Initialize the content database using the canonical method from dbs crate
    let _ = DatabaseManager::open(content_db_path).expect("Failed to initialize content database");

    // Initialize the agent database using the canonical method from dbs crate
    let agent_conn = Connection::open(agent_db_path).expect("Failed to open agent db connection");
    dbs::manager::init_agent_db(&agent_conn).expect("Failed to initialize agent database");
}
