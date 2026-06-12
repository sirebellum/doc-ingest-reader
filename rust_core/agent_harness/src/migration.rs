use anyhow::Result;
use rusqlite::Connection;

/// Migrates relevant structure data from the ephemeral agent database to the persistent content database deterministically.
pub fn migrate_agent_to_content(agent_db_path: &str, content_db_path: &str, document_id: &str) -> Result<()> {
    // Open connection directly to content_db
    let mut content_db = Connection::open(content_db_path)?;
    
    // Attach the ephemeral agent_db
    content_db.execute(&format!("ATTACH DATABASE '{}' AS scratch", agent_db_path), [])?;
    
    let tx = content_db.transaction()?;
    
    // Perform atomic inserts from the scratch schema directly into the main schema
    tx.execute(
        "INSERT OR IGNORE INTO main.sections SELECT * FROM scratch.sections WHERE document_id = ?",
        [document_id],
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO main.blocks SELECT * FROM scratch.blocks WHERE document_id = ?",
        [document_id],
    )?;
    // We do not copy pass1_chunks or agent_context as they are ephemeral, 
    // but we can copy job_chunks or processing_jobs if necessary.
    tx.execute(
        "INSERT OR IGNORE INTO main.job_chunks SELECT * FROM scratch.job_chunks WHERE job_id IN (SELECT id FROM scratch.processing_jobs WHERE document_id = ?)",
        [document_id],
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO main.processing_jobs SELECT * FROM scratch.processing_jobs WHERE document_id = ?",
        [document_id],
    )?;
    
    tx.commit()?;
    
    // Detach
    content_db.execute("DETACH DATABASE scratch", [])?;
    
    // Wipe scratch database contents upon success
    let agent_db = Connection::open(agent_db_path)?;
    agent_db.execute("DELETE FROM sections WHERE document_id = ?", [document_id])?;
    agent_db.execute("DELETE FROM blocks WHERE document_id = ?", [document_id])?;
    agent_db.execute("DELETE FROM pass1_chunks WHERE document_id = ?", [document_id])?;
    agent_db.execute("DELETE FROM agent_context", [])?;
    agent_db.execute("DELETE FROM processing_jobs WHERE document_id = ?", [document_id])?;
    agent_db.execute("DELETE FROM job_chunks WHERE job_id IN (SELECT id FROM processing_jobs WHERE document_id = ?)", [document_id])?;
    
    Ok(())
}
