pub mod schema;
pub mod manager;

pub use manager::DatabaseManager;

#[cxx::bridge]
mod ffi {
    extern "Rust" {
        type DatabaseManager;

        // Stub for opening DB from C++
        fn new_database_manager(path: &str) -> Result<Box<DatabaseManager>>;

        // Stub for searching blocks (FTS5) from C++
        // Returning a byte buffer of blocks to avoid complex CXX vector bindings initially
        fn search_blocks_buffer(self: &DatabaseManager, query: &str) -> Result<Vec<u8>>;
    }
}

pub fn new_database_manager(path: &str) -> Result<Box<DatabaseManager>, contracts::error::AppError> {
    let db = DatabaseManager::open(path)?;
    Ok(Box::new(db))
}

impl DatabaseManager {
    // Wrapper for CXX bridge to return byte buffer instead of Vec<String>
    pub fn search_blocks_buffer(&self, query: &str) -> Result<Vec<u8>, contracts::error::AppError> {
        let results = self.search_blocks(query)?;
        serde_json::to_vec(&results).map_err(|e| contracts::error::AppError::SerdeError(e))
    }
}
