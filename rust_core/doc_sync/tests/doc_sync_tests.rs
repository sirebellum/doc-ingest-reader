use doc_sync::{compress_lzw, decompress_lzw, merge_three_way, fuzzy_reanchor, chunk_payload};
use serde_json::json;

// --- LZW Packing/Unpacking Tests ---

#[test]
fn test_lzw_roundtrip_standard_text() {
    let original = "This is a standard text for compression testing. Let's see if it works as expected.";
    let compressed = compress_lzw(original).expect("Compression failed");
    let compressed_str = String::from_utf8(compressed).expect("Invalid UTF-8 from base64");
    
    let decompressed = decompress_lzw(&compressed_str).expect("Decompression failed");
    let decompressed_str = String::from_utf8(decompressed).expect("Invalid UTF-8 from decompressed bytes");
    
    assert_eq!(original, decompressed_str);
}

#[test]
fn test_lzw_empty_buffer() {
    let original = "";
    let compressed = compress_lzw(original).expect("Compression failed on empty string");
    let compressed_str = String::from_utf8(compressed).expect("Invalid UTF-8 from base64");
    
    let decompressed = decompress_lzw(&compressed_str).expect("Decompression failed on empty string");
    let decompressed_str = String::from_utf8(decompressed).expect("Invalid UTF-8 from decompressed bytes");
    
    assert_eq!(original, decompressed_str);
}

#[test]
fn test_lzw_highly_repetitive_text() {
    let original = "A".repeat(10000);
    let compressed = compress_lzw(&original).expect("Compression failed");
    let compressed_str = String::from_utf8(compressed.clone()).expect("Invalid UTF-8 from base64");
    
    // Check compression ratio
    assert!(compressed.len() < original.len());
    
    let decompressed = decompress_lzw(&compressed_str).expect("Decompression failed");
    let decompressed_str = String::from_utf8(decompressed).expect("Invalid UTF-8 from decompressed bytes");
    
    assert_eq!(original, decompressed_str);
}


// --- Myers 3-Way LCS Merge Tests ---

#[test]
fn test_merge_non_overlapping_edits() {
    let base = "line1\nline2\nline3\n";
    let ours = "line1\nline2 changed\nline3\n";
    let theirs = "line1\nline2\nline3 changed\n";
    
    let merged_bytes = merge_three_way(base, ours, theirs).expect("Merge failed");
    let merged = String::from_utf8(merged_bytes).unwrap();
    
    assert_eq!(merged, "line1\nline2 changed\nline3 changed\n");
}

#[test]
fn test_merge_overlapping_edits() {
    let base = "line1\nline2\nline3\n";
    let ours = "line1\nline2 changed by ours\nline3\n";
    let theirs = "line1\nline2 changed by theirs\nline3\n";
    
    let merged_bytes = merge_three_way(base, ours, theirs).expect("Merge failed");
    let merged = String::from_utf8(merged_bytes).unwrap();
    
    let expected = "line1\n<<<<<<< OURS\nline2 changed by ours\n=======\nline2 changed by theirs\n>>>>>>> THEIRS\nline3\n";
    assert_eq!(merged, expected);
}

#[test]
fn test_merge_identical_overlapping_edits_mixed() {
    let base = "line1\nline2\nline3\nline4\nline5\n";
    let ours = "line1 ours\nline2\nline3 identical edit\nline4\nline5\n";
    let theirs = "line1\nline2\nline3 identical edit\nline4\nline5 theirs\n";
    
    let merged_bytes = merge_three_way(base, ours, theirs).expect("Merge failed");
    let merged = String::from_utf8(merged_bytes).unwrap();
    
    let expected = "line1 ours\nline2\nline3 identical edit\nline4\nline5 theirs\n";
    assert_eq!(merged, expected);
}

#[test]
fn test_merge_identical_base_states() {
    let base = "line1\nline2\nline3\n";
    
    // ours == base
    let merged_bytes = merge_three_way(base, base, "changed").expect("Merge failed");
    assert_eq!(String::from_utf8(merged_bytes).unwrap(), "changed");
    
    // theirs == base
    let merged_bytes = merge_three_way(base, "changed", base).expect("Merge failed");
    assert_eq!(String::from_utf8(merged_bytes).unwrap(), "changed");
    
    // ours == theirs
    let merged_bytes = merge_three_way(base, "changed", "changed").expect("Merge failed");
    assert_eq!(String::from_utf8(merged_bytes).unwrap(), "changed");
}

#[test]
fn test_merge_empty_buffers() {
    let merged_bytes = merge_three_way("", "ours", "theirs").expect("Merge failed");
    assert_eq!(String::from_utf8(merged_bytes).unwrap(), "<<<<<<< OURS\nours\n=======\ntheirs\n>>>>>>> THEIRS");
    
    let merged_bytes = merge_three_way("", "", "").expect("Merge failed");
    assert_eq!(String::from_utf8(merged_bytes).unwrap(), "");
}


// --- W3C Fuzzy Re-anchoring Tests ---

#[test]
fn test_fuzzy_reanchor_exact_match() {
    let highlighted_text = "target phrase";
    let context_json = json!({
        "prefix": "this is the ",
        "suffix": " in the document.",
        "offset": 12
    }).to_string();
    let blocks_json = json!([
        {
            "id": "block1",
            "text": "this is the target phrase in the document."
        }
    ]).to_string();
    
    let res_bytes = fuzzy_reanchor(highlighted_text, &context_json, &blocks_json).expect("Reanchor failed");
    let res_str = String::from_utf8(res_bytes).unwrap();
    let json_val: serde_json::Value = serde_json::from_str(&res_str).expect("Failed to deserialize result");
    
    assert_eq!(json_val["blockId"], "block1");
    assert_eq!(json_val["startOffset"], 12);
    assert_eq!(json_val["endOffset"], 12 + "target phrase".len());
    // Score calculation: 0.5 (base) + 0.25 (prefix matches) + 0.25 (suffix matches)
    assert_eq!(json_val["confidence"], 1.0);
}

#[test]
fn test_fuzzy_reanchor_fuzzy_match() {
    let highlighted_text = "target";
    let context_json = json!({
        "prefix": "this is the ", // not fully present in block text
        "suffix": " for testing",
        "offset": 0
    }).to_string();
    let blocks_json = json!([
        {
            "id": "block1",
            "text": "target for testing"
        }
    ]).to_string();
    
    let res_bytes = fuzzy_reanchor(highlighted_text, &context_json, &blocks_json).expect("Reanchor failed");
    let res_str = String::from_utf8(res_bytes).unwrap();
    let json_val: serde_json::Value = serde_json::from_str(&res_str).expect("Failed to deserialize result");
    
    assert_eq!(json_val["blockId"], "block1");
    assert_eq!(json_val["startOffset"], 0);
    assert_eq!(json_val["endOffset"], 6);
    // score calculation: 0.5 (base) + 0.25 (suffix matches) + 0.0 (empty block prefix) = 0.75
    // Note: the score used to be 1.0 because the prefix match succeeded for an empty block prefix, which is now fixed.
    assert_eq!(json_val["confidence"], 0.75);
}

#[test]
fn test_fuzzy_reanchor_missing_text() {
    let highlighted_text = "missing phrase";
    let context_json = json!({
        "prefix": "prefix ",
        "suffix": " suffix",
        "offset": 0
    }).to_string();
    let blocks_json = json!([
        {
            "id": "block1",
            "text": "This block does not contain the text we are looking for."
        }
    ]).to_string();
    
    let res_bytes = fuzzy_reanchor(highlighted_text, &context_json, &blocks_json).expect("Reanchor failed");
    let res_str = String::from_utf8(res_bytes).unwrap();
    
    assert_eq!(res_str, "null");
}

#[test]
fn test_fuzzy_reanchor_empty_boundary() {
    let highlighted_text = "target phrase";
    let context_json = json!({
        "prefix": "prefix ",
        "suffix": " suffix",
        "offset": 0
    }).to_string();
    let blocks_json = json!([
        {
            "id": "block1",
            "text": "target phrase"
        }
    ]).to_string();
    
    let res_bytes = fuzzy_reanchor(highlighted_text, &context_json, &blocks_json).expect("Reanchor failed");
    let res_str = String::from_utf8(res_bytes).unwrap();
    let json_val: serde_json::Value = serde_json::from_str(&res_str).expect("Failed to deserialize result");
    
    assert_eq!(json_val["blockId"], "block1");
    // With empty prefix/suffix in the block text, they should NOT receive the 0.25 bonus each.
    // Base score is 0.5.
    assert_eq!(json_val["confidence"], 0.5);
}

// --- Chunk Payload Tests ---

#[test]
fn test_chunk_payload() {
    let mut payload = String::new();
    for _ in 0..1000 {
        payload.push('A');
    }
    
    let tx_id = "test-tx";
    let result = chunk_payload(&payload, tx_id).unwrap();
    let result_str = String::from_utf8(result).unwrap();
    
    let chunks: Vec<String> = serde_json::from_str(&result_str).unwrap();
    assert_eq!(chunks.len(), 2);
    
    assert!(chunks[0].starts_with("test-tx|0|2|"));
    assert!(chunks[1].starts_with("test-tx|1|2|"));
}

#[test]
fn test_fuzzy_reanchor_multibyte_boundary() {
    // Japanese text where prefix.len() in bytes would cause mid-char slicing
    // "日本語テキスト" = 7 chars × 3 bytes = 21 bytes
    let highlighted_text = "target";
    let context_json = json!({
        "prefix": "日本語テキスト",
        "suffix": "終わり",
        "offset": 0
    }).to_string();
    let blocks_json = json!([
        {
            "id": "block1",
            "text": "日本語テキストtarget終わり"
        }
    ]).to_string();

    // This would have panicked before the fix because prefix.len() (21 bytes)
    // subtracted from the byte position of "target" could land mid-character.
    let res_bytes = fuzzy_reanchor(highlighted_text, &context_json, &blocks_json)
        .expect("Reanchor should not panic on multi-byte text");
    let res_str = String::from_utf8(res_bytes).unwrap();
    let json_val: serde_json::Value = serde_json::from_str(&res_str)
        .expect("Result should be valid JSON");

    assert_eq!(json_val["blockId"], "block1");
    // "target" starts at byte 21 (after 7 × 3-byte CJK chars)
    assert_eq!(json_val["startOffset"], 21);
    assert_eq!(json_val["endOffset"], 21 + "target".len());
}

#[test]
fn test_fuzzy_reanchor_emoji_prefix_suffix() {
    // Emoji characters (4 bytes each) in prefix and suffix
    let highlighted_text = "find me";
    let context_json = json!({
        "prefix": "🎉🎊🎈",
        "suffix": "🔥💯",
        "offset": 0
    }).to_string();
    let blocks_json = json!([
        {
            "id": "emoji-block",
            "text": "🎉🎊🎈find me🔥💯"
        }
    ]).to_string();

    let res_bytes = fuzzy_reanchor(highlighted_text, &context_json, &blocks_json)
        .expect("Reanchor should not panic with emoji context");
    let res_str = String::from_utf8(res_bytes).unwrap();
    assert_ne!(res_str, "null", "Should find match in emoji-surrounded text");
    let json_val: serde_json::Value = serde_json::from_str(&res_str)
        .expect("Result should be valid JSON");
    assert_eq!(json_val["blockId"], "emoji-block");
}
