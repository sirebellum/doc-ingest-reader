use anyhow::Result;
use rusqlite::Connection;
use contracts::ExtractionChunk;
use std::ffi::{CStr, c_void};
use std::os::raw::c_char;

/// Ingests a raw extraction chunk into the agent database, enforcing a ~200 token hard limit
/// per block by splitting text based on paragraphs/sentences.
pub fn ingest_chunk_to_agent_db(db: &Connection, extraction: &ExtractionChunk) -> Result<()> {
    // Basic heuristic: 1 word ~ 1.3 tokens. So 200 tokens ~ 150 words.
    let max_words = 150;
    
    let raw_text = &extraction.raw_text;
    
    // Split by paragraphs first
    let paragraphs: Vec<&str> = raw_text.split("\n\n").collect();
    
    let mut current_chunk = Vec::new();
    let mut current_word_count = 0;
    let mut sequence_order = 0;

    let mut insert_block = |content: &str| -> Result<()> {
        let id = format!("raw-{}-{}", extraction.chunk_index, sequence_order);
        let doc_id = &extraction.document_id;
        
        // We insert this into `agent_blocks` as un-explored raw text.
        // The LLM will later read this and restructure it.
        db.execute(
            "INSERT INTO agent_blocks (id, section_id, document_id, block_type, content, sort_order, sequence_order, is_explored) 
             VALUES (?1, NULL, ?2, 'raw_text', ?3, ?4, ?5, 0)",
            rusqlite::params![id, doc_id, content, sequence_order, sequence_order]
        )?;
        sequence_order += 1;
        Ok(())
    };

    for paragraph in paragraphs {
        let words_in_para = paragraph.split_whitespace().count();
        
        if current_word_count + words_in_para > max_words {
            if !current_chunk.is_empty() {
                // Flush current
                insert_block(&current_chunk.join("\n\n"))?;
                current_chunk.clear();
                current_word_count = 0;
            }
            
            if words_in_para > max_words {
                // If a single paragraph is too large, split by sentences.
                let sentences: Vec<&str> = paragraph.split(". ").collect();
                let mut p_chunk = Vec::new();
                let mut p_words = 0;
                
                for sentence in sentences {
                    let s_words = sentence.split_whitespace().count();
                    if p_words + s_words > max_words && !p_chunk.is_empty() {
                        insert_block(&p_chunk.join(". "))?;
                        p_chunk.clear();
                        p_words = 0;
                    }
                    p_chunk.push(sentence.to_string());
                    p_words += s_words;
                }
                
                if !p_chunk.is_empty() {
                    current_chunk.push(p_chunk.join(". "));
                    current_word_count += p_words;
                }
            } else {
                current_chunk.push(paragraph.to_string());
                current_word_count += words_in_para;
            }
        } else {
            current_chunk.push(paragraph.to_string());
            current_word_count += words_in_para;
        }
    }

    if !current_chunk.is_empty() {
        insert_block(&current_chunk.join("\n\n"))?;
    }

    Ok(())
}

/// FFI: Ingest extraction JSON into the agent database
#[no_mangle]
pub extern "C" fn agent_ingest_ffi(
    agent_db_ptr: *mut c_void,
    page_extraction_json: *const c_char,
) -> i32 {
    if agent_db_ptr.is_null() || page_extraction_json.is_null() {
        return -1;
    }

    let db = unsafe { &*(agent_db_ptr as *mut Connection) };

    let page_json_str = unsafe {
        match CStr::from_ptr(page_extraction_json).to_str() {
            Ok(s) => s,
            Err(_) => return -2,
        }
    };

    let extraction: ExtractionChunk = match serde_json::from_str(page_json_str) {
        Ok(ext) => ext,
        Err(e) => {
            eprintln!("Failed to parse page extraction JSON in agent ingest: {}", e);
            return -3;
        }
    };

    match ingest_chunk_to_agent_db(db, &extraction) {
        Ok(_) => 0,
        Err(e) => {
            eprintln!("Ingestion to agent DB failed: {}", e);
            -4
        }
    }
}
