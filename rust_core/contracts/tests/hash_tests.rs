use contracts::hash::generate_block_id;

#[test]
fn test_generate_block_id_divergence() {
    // Known inputs and expected output to test against TS divergence
    let doc_id = "doc_12345";
    let seq_idx = 1;
    let content = "Chapter 1";
    
    let hash = generate_block_id(doc_id, seq_idx, content);
    // With null-byte delimiters: "doc_12345\x001\x00Chapter 1" -> sha256
    assert_eq!(hash, "blk_933ca4153e7ae2dd373403dcc5ce48f2832d842d00407044a524f22b510bcf64");
}

#[test]
fn test_old_collision_case_now_differs() {
    // These two inputs previously collided when hashed without delimiters:
    // ("doc_12345", 1, "Chapter 1") and ("doc_1234", 51, "Chapter 1")
    // both produced the same byte stream "doc_123451Chapter 1".
    // With null-byte delimiters they must now produce different hashes.
    let hash_a = generate_block_id("doc_12345", 1, "Chapter 1");
    let hash_b = generate_block_id("doc_1234", 51, "Chapter 1");
    assert_ne!(hash_a, hash_b, "hash collision should no longer occur with delimiter fix");
}

#[test]
fn test_empty_string_inputs() {
    // Empty strings should still produce a valid, deterministic hash
    let hash = generate_block_id("", 0, "");
    assert!(hash.starts_with("blk_"));
    assert_eq!(hash.len(), 4 + 64); // "blk_" + 64 hex chars
    
    // Same empty inputs should be deterministic
    let hash2 = generate_block_id("", 0, "");
    assert_eq!(hash, hash2);
}

#[test]
fn test_unicode_content() {
    // Unicode characters should hash correctly
    let hash = generate_block_id("doc_u", 0, "日本語テスト 🚀");
    assert!(hash.starts_with("blk_"));
    assert_eq!(hash.len(), 4 + 64);
    
    // Should be deterministic
    let hash2 = generate_block_id("doc_u", 0, "日本語テスト 🚀");
    assert_eq!(hash, hash2);
}

#[test]
fn test_different_sequence_indices_differ() {
    // Different sequence indices with same doc_id and content must produce different hashes
    let hash_0 = generate_block_id("doc_abc", 0, "same content");
    let hash_1 = generate_block_id("doc_abc", 1, "same content");
    let hash_99 = generate_block_id("doc_abc", 99, "same content");
    
    assert_ne!(hash_0, hash_1);
    assert_ne!(hash_0, hash_99);
    assert_ne!(hash_1, hash_99);
}
