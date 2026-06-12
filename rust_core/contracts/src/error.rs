use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Layout parsing error: {0}")]
    LayoutParsingError(String),

    #[error("Database collision: {0}")]
    DatabaseCollision(String),

    #[error("FFI encoding fault: {0}")]
    FfiEncodingFault(String),

    #[error("Context overflow: {0}")]
    ContextOverflow(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    SerdeError(#[from] serde_json::Error),

    #[error("Database error: {0}")]
    DatabaseError(String),

    #[error("Network error: {0}")]
    NetworkError(String),

    #[error("Mutex lock error: {0}")]
    MutexError(String),

    #[error("Internal error: {0}")]
    Generic(String),
}

// Convert from anyhow::Error to our AppError for intermediate compatibility if needed
impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        AppError::Generic(err.to_string())
    }
}
