use sha2::{Sha256, Digest};

pub fn generate_block_id(document_id: &str, sequence_index: usize, raw_text_content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(document_id.as_bytes());
    hasher.update(sequence_index.to_string().as_bytes());
    hasher.update(raw_text_content.as_bytes());
    
    let result = hasher.finalize();
    format!("blk_{:x}", result)
}

