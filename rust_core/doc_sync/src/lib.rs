
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

#[derive(Clone, Debug)]
struct Edit<'a> {
    base_start: usize,
    base_end: usize,
    new_lines: Vec<&'a str>,
}

fn split_lines(s: &str) -> Vec<&str> {
    let mut lines = Vec::new();
    let mut last = 0;
    for (i, b) in s.char_indices() {
        if b == '\n' {
            lines.push(&s[last..=i]);
            last = i + 1;
        }
    }
    if last < s.len() {
        lines.push(&s[last..]);
    }
    lines
}

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

    let base_lines = split_lines(base);
    let ours_lines = split_lines(ours);
    let theirs_lines = split_lines(theirs);

    let diff_ours = TextDiff::from_slices(&base_lines, &ours_lines);
    let diff_theirs = TextDiff::from_slices(&base_lines, &theirs_lines);

    let mut ours_edits = Vec::new();
    for op in diff_ours.ops() {
        match op {
            similar::DiffOp::Equal { .. } => {}
            similar::DiffOp::Delete { old_index, old_len, .. } => ours_edits.push(Edit { base_start: *old_index, base_end: *old_index + *old_len, new_lines: vec![] }),
            similar::DiffOp::Insert { old_index, new_index, new_len } => ours_edits.push(Edit { base_start: *old_index, base_end: *old_index, new_lines: ours_lines[*new_index .. *new_index + *new_len].to_vec() }),
            similar::DiffOp::Replace { old_index, old_len, new_index, new_len } => ours_edits.push(Edit { base_start: *old_index, base_end: *old_index + *old_len, new_lines: ours_lines[*new_index .. *new_index + *new_len].to_vec() }),
        }
    }

    let mut theirs_edits = Vec::new();
    for op in diff_theirs.ops() {
        match op {
            similar::DiffOp::Equal { .. } => {}
            similar::DiffOp::Delete { old_index, old_len, .. } => theirs_edits.push(Edit { base_start: *old_index, base_end: *old_index + *old_len, new_lines: vec![] }),
            similar::DiffOp::Insert { old_index, new_index, new_len } => theirs_edits.push(Edit { base_start: *old_index, base_end: *old_index, new_lines: theirs_lines[*new_index .. *new_index + *new_len].to_vec() }),
            similar::DiffOp::Replace { old_index, old_len, new_index, new_len } => theirs_edits.push(Edit { base_start: *old_index, base_end: *old_index + *old_len, new_lines: theirs_lines[*new_index .. *new_index + *new_len].to_vec() }),
        }
    }

    let mut edits = Vec::new();
    for e in ours_edits { edits.push((0, e)); }
    for e in theirs_edits { edits.push((1, e)); }
    edits.sort_by_key(|(_, e)| (e.base_start, e.base_end));

    let mut clusters: Vec<Vec<(u8, Edit)>> = Vec::new();
    for edit in edits {
        if let Some(last_cluster) = clusters.last_mut() {
            let mut overlaps_any = false;
            for (_, existing_edit) in last_cluster.iter() {
                let max_s = std::cmp::max(edit.1.base_start, existing_edit.base_start);
                let min_e = std::cmp::min(edit.1.base_end, existing_edit.base_end);
                if max_s < min_e {
                    overlaps_any = true;
                    break;
                }
                if edit.1.base_start == existing_edit.base_start && edit.1.base_end == existing_edit.base_end && edit.1.base_start == edit.1.base_end {
                    overlaps_any = true;
                    break;
                }
            }
            if overlaps_any {
                last_cluster.push(edit);
                continue;
            }
        }
        clusters.push(vec![edit]);
    }

    let mut result = String::new();
    let mut i = 0;
    for cluster in clusters {
        let cluster_start = cluster.iter().map(|(_, e)| e.base_start).min().unwrap_or(0);
        let cluster_end = cluster.iter().map(|(_, e)| e.base_end).max().unwrap_or(0);

        if i < cluster_start {
            for line in &base_lines[i..cluster_start] {
                result.push_str(line);
            }
        }
        i = cluster_end;

        let ours_in_cluster: Vec<_> = cluster.iter().filter(|(side, _)| *side == 0).map(|(_, e)| e).collect();
        let theirs_in_cluster: Vec<_> = cluster.iter().filter(|(side, _)| *side == 1).map(|(_, e)| e).collect();

        if theirs_in_cluster.is_empty() {
            let mut j = cluster_start;
            for e in ours_in_cluster {
                if j < e.base_start {
                    for line in &base_lines[j..e.base_start] {
                        result.push_str(line);
                    }
                }
                for line in &e.new_lines {
                    result.push_str(line);
                }
                j = e.base_end;
            }
            if j < cluster_end {
                for line in &base_lines[j..cluster_end] {
                    result.push_str(line);
                }
            }
        } else if ours_in_cluster.is_empty() {
            let mut j = cluster_start;
            for e in theirs_in_cluster {
                if j < e.base_start {
                    for line in &base_lines[j..e.base_start] {
                        result.push_str(line);
                    }
                }
                for line in &e.new_lines {
                    result.push_str(line);
                }
                j = e.base_end;
            }
            if j < cluster_end {
                for line in &base_lines[j..cluster_end] {
                    result.push_str(line);
                }
            }
        } else {
            let mut ours_lines_res = Vec::new();
            let mut j = cluster_start;
            for e in &ours_in_cluster {
                if j < e.base_start {
                    for line in &base_lines[j..e.base_start] {
                        ours_lines_res.push(*line);
                    }
                }
                for line in &e.new_lines {
                    ours_lines_res.push(*line);
                }
                j = e.base_end;
            }
            if j < cluster_end {
                for line in &base_lines[j..cluster_end] {
                    ours_lines_res.push(*line);
                }
            }

            let mut theirs_lines_res = Vec::new();
            let mut j = cluster_start;
            for e in &theirs_in_cluster {
                if j < e.base_start {
                    for line in &base_lines[j..e.base_start] {
                        theirs_lines_res.push(*line);
                    }
                }
                for line in &e.new_lines {
                    theirs_lines_res.push(*line);
                }
                j = e.base_end;
            }
            if j < cluster_end {
                for line in &base_lines[j..cluster_end] {
                    theirs_lines_res.push(*line);
                }
            }

            if ours_lines_res == theirs_lines_res {
                for line in ours_lines_res {
                    result.push_str(line);
                }
            } else {
                if !result.ends_with('\n') && !result.is_empty() {
                    result.push('\n');
                }
                result.push_str("<<<<<<< OURS\n");
                for line in ours_lines_res {
                    result.push_str(line);
                }
                if !result.ends_with('\n') {
                    result.push('\n');
                }
                result.push_str("=======\n");
                for line in theirs_lines_res {
                    result.push_str(line);
                }
                if !result.ends_with('\n') {
                    result.push('\n');
                }
                result.push_str(">>>>>>> THEIRS\n");
            }
        }
    }

    if i < base_lines.len() {
        for line in &base_lines[i..] {
            result.push_str(line);
        }
    }

    Ok(result.into_bytes())
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
    let mut chunks_data: Vec<&str> = Vec::new();
    let mut start_idx = 0;
    let mut current_len = 0;

    for (i, c) in payload.char_indices() {
        let c_len = c.len_utf8();
        if current_len + c_len > mtu_size {
            chunks_data.push(&payload[start_idx..i]);
            start_idx = i;
            current_len = c_len;
        } else {
            current_len += c_len;
        }
    }
    if start_idx < payload.len() {
        chunks_data.push(&payload[start_idx..]);
    }

    let total_chunks = chunks_data.len();
    let mut chunks = Vec::with_capacity(total_chunks);

    for (i, chunk_payload) in chunks_data.into_iter().enumerate() {
        let checksum = compute_checksum(chunk_payload);
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
    let mut best_match: Option<AnchoringResult> = None;
    let mut highest_score = -1.0;

    for block in blocks {
        let text = &block.text;
        let mut idx = text.find(target_text);
        while let Some(i) = idx {
            let mut score = 0.5;
            let prefix_start = i.saturating_sub(context.prefix.len());
            let mut safe_prefix_start = prefix_start;
            while safe_prefix_start < i && !text.is_char_boundary(safe_prefix_start) {
                safe_prefix_start += 1;
            }
            let block_prefix = &text[safe_prefix_start..i];
            let end_idx = i + target_text.len();
            let suffix_end = std::cmp::min(end_idx + context.suffix.len(), text.len());
            let mut safe_suffix_end = suffix_end;
            while safe_suffix_end > end_idx && !text.is_char_boundary(safe_suffix_end) {
                safe_suffix_end -= 1;
            }
            let block_suffix = &text[end_idx..safe_suffix_end];

            let clean_prefix = context.prefix.trim();
            let cp_start = clean_prefix.char_indices().rev().nth(9).map_or(0, |(idx, _)| idx);
            if !clean_prefix.is_empty() && !block_prefix.is_empty() && (block_prefix.contains(&clean_prefix[cp_start..]) || clean_prefix.contains(block_prefix)) {
                score += 0.25;
            }

            let clean_suffix = context.suffix.trim();
            let cs_end = clean_suffix.char_indices().nth(10).map_or(clean_suffix.len(), |(idx, _)| idx);
            if !clean_suffix.is_empty() && !block_suffix.is_empty() && (block_suffix.contains(&clean_suffix[..cs_end]) || clean_suffix.contains(block_suffix)) {
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
            
            let mut next_start = i + 1;
            while next_start < text.len() && !text.is_char_boundary(next_start) {
                next_start += 1;
            }
            idx = if next_start < text.len() {
                text[next_start..].find(target_text).map(|j| next_start + j)
            } else {
                None
            };
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
