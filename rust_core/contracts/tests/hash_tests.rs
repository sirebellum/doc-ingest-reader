use contracts::hash::generate_block_id;

#[test]
fn test_generate_block_id_divergence() {
    // Known inputs and expected output to test against TS divergence
    let doc_id = "doc_12345";
    let seq_idx = 1;
    let content = "Chapter 1";
    
    let hash = generate_block_id(doc_id, seq_idx, content);
    // "doc_123451Chapter 1" -> sha256 -> 3a886e20d6a26f7f2d2130e23a9b8c955f3de796c2bd4df83d5c8920233af806
    assert_eq!(hash, "blk_3a886e20d6a26f7f2d2130e23a9b8c955f3de796c2bd4df83d5c8920233af806");
}
