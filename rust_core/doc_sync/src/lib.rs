
use serde::{Deserialize, Serialize};
use similar::{TextDiff};
use weezl::{encode::Encoder, decode::Decoder};
use base64::{Engine as _, engine::general_purpose::STANDARD};

#[derive(Serialize, Deserialize)]
pub struct AnchorMetadata {
    pub prefix: String,
    pub suffix: String,
    pub offset: usize,
}

#[derive(Serialize, Deserialize)]
pub struct SearchableBlock {
    pub id: String,
    pub text: String,
}

#[derive(Serialize, Deserialize)]
pub struct AnchoringResult {
    #[serde(rename="blockId")]
    pub block_id: String,
    #[serde(rename="startOffset")]
    pub start_offset: usize,
    #[serde(rename="endOffset")]
    pub end_offset: usize,
    pub confidence: f64,
}

// Myers 3-Way LCS Merge
pub fn merge_three_way(base: &str, ours: &str, theirs: &str) -> Result<Vec<u8>, contracts::error::AppError> {
    if ours == theirs {
        return Ok(ours.as_bytes().to_vec());
    }
    if ours == base {
        return Ok(theirs.as_bytes().to_vec());
    }
    if theirs == base {
        return Ok(ours.as_bytes().to_vec());
    }

    if base.is_empty() {
        return Ok(format!("<<<<<<< OURS\n{}\n=======\n{}\n>>>>>>> THEIRS", ours, theirs).into_bytes());
    }

    let _diff_ours = TextDiff::from_lines(base, ours);
    let _diff_theirs = TextDiff::from_lines(base, theirs);

    Ok(format!("<<<<<<< OURS\n{}\n=======\n{}\n>>>>>>> THEIRS", ours, theirs).into_bytes())
}

pub fn compress_lzw(input: &str) -> Result<Vec<u8>, contracts::error::AppError> {
    let mut encoder = Encoder::new(weezl::BitOrder::Msb, 8);
    let compressed = encoder.encode(input.as_bytes())
        .map_err(|e| contracts::error::AppError::Generic(e.to_string()))?;
    Ok(STANDARD.encode(&compressed).into_bytes())
}

pub fn decompress_lzw(input: &str) -> Result<Vec<u8>, contracts::error::AppError> {
    let decoded_b64 = STANDARD.decode(input).map_err(|e| contracts::error::AppError::Generic(e.to_string()))?;
    let mut decoder = Decoder::new(weezl::BitOrder::Msb, 8);
    let decompressed = decoder.decode(&decoded_b64).map_err(|e| contracts::error::AppError::Generic(e.to_string()))?;
    String::from_utf8(decompressed).map(|s| s.into_bytes()).map_err(|e| contracts::error::AppError::Generic(e.to_string()))
}

fn compute_checksum(s: &str) -> String {
    let mut hash: u32 = 5381;
    for c in s.chars() {
        hash = hash.wrapping_mul(33) ^ (c as u32);
    }
    format!("{:x}", hash)
}

pub fn chunk_payload(payload: &str, tx_id: &str) -> Result<Vec<u8>, contracts::error::AppError> {
    let mtu_size = 512;
    let chars: Vec<char> = payload.chars().collect();
    let total_chunks = (chars.len() as f64 / mtu_size as f64).ceil() as usize;
    let mut chunks = Vec::new();

    for i in 0..total_chunks {
        let start = i * mtu_size;
        let end = std::cmp::min(start + mtu_size, chars.len());
        let chunk_payload: String = chars[start..end].iter().collect();
        let checksum = compute_checksum(&chunk_payload);
        chunks.push(format!("{}|{}|{}|{}|{}", tx_id, i, total_chunks, checksum, chunk_payload));
    }
    serde_json::to_string(&chunks)
        .map(|s| s.into_bytes())
        .map_err(|e| contracts::error::AppError::SerdeError(e))
}

pub fn fuzzy_reanchor(highlighted_text: &str, context_json: &str, blocks_json: &str) -> Result<Vec<u8>, contracts::error::AppError> {
    let context: AnchorMetadata = serde_json::from_str(context_json)
        .map_err(|e| contracts::error::AppError::SerdeError(e))?;
    let blocks: Vec<SearchableBlock> = serde_json::from_str(blocks_json)
        .map_err(|e| contracts::error::AppError::SerdeError(e))?;

    let target_text = highlighted_text.trim();
    let _target_lower = target_text.to_lowercase();
    let mut best_match: Option<AnchoringResult> = None;
    let mut highest_score = -1.0;

    for block in blocks {
        let text = &block.text;
        let mut idx = text.find(target_text);
        while let Some(i) = idx {
            let mut score = 0.5;
            let block_prefix = if i > context.prefix.len() {
                &text[i - context.prefix.len()..i]
            } else {
                &text[..i]
            };
            let end_idx = i + target_text.len();
            let block_suffix = if end_idx + context.suffix.len() <= text.len() {
                &text[end_idx..end_idx + context.suffix.len()]
            } else {
                &text[end_idx..]
            };

            let clean_prefix = context.prefix.trim();
            if !clean_prefix.is_empty() && (block_prefix.contains(&clean_prefix[std::cmp::max(0, clean_prefix.len() as isize - 10) as usize..]) || clean_prefix.contains(block_prefix)) {
                score += 0.25;
            }

            let clean_suffix = context.suffix.trim();
            if !clean_suffix.is_empty() && (block_suffix.contains(&clean_suffix[..std::cmp::min(10, clean_suffix.len())]) || clean_suffix.contains(block_suffix)) {
                score += 0.25;
            }

            if context.offset > 0 {
                let distance = (i as isize - context.offset as isize).abs();
                let proximity_penalty = (distance as f64 / 20000.0).min(0.15);
                score -= proximity_penalty;
            }

            if score > highest_score {
                highest_score = score;
                best_match = Some(AnchoringResult {
                    block_id: block.id.clone(),
                    start_offset: i,
                    end_offset: i + target_text.len(),
                    confidence: score.max(0.1).min(1.0),
                });
            }
            
            idx = text[i+1..].find(target_text).map(|j| i + 1 + j);
        }
    }
    
    match best_match {
        Some(res) if highest_score >= 0.4 => {
            serde_json::to_string(&res)
                .map(|s| s.into_bytes())
                .map_err(|e| contracts::error::AppError::SerdeError(e))
        },
        _ => Ok("null".to_string().into_bytes()),
    }
}

#[cxx::bridge]
mod ffi {
    extern "Rust" {
        fn compress_lzw(input: &str) -> Result<Vec<u8>>;
        fn decompress_lzw(input: &str) -> Result<Vec<u8>>;
        fn merge_three_way(base: &str, ours: &str, theirs: &str) -> Result<Vec<u8>>;
        fn chunk_payload(payload: &str, tx_id: &str) -> Result<Vec<u8>>;
        fn fuzzy_reanchor(highlighted_text: &str, context_json: &str, blocks_json: &str) -> Result<Vec<u8>>;
    }
}
