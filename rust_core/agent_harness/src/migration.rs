use anyhow::Result;
use rusqlite::Connection;

/// Migrates relevant structure data from the agent_db to the content_db deterministically,
/// then drops temporary tables/data from agent_db as requested.
pub fn migrate_agent_data_to_content_db(agent_db: &Connection, content_db: &Connection) -> Result<()> {
    // Scaffold logic for migrating parsed data
    // In reality this would SELECT from agent_graph_nodes, etc., and INSERT into content_db
    
    // Attach agent_db to content_db to perform cross-db inserts
    let agent_db_path = agent_db.query_row("PRAGMA database_list", [], |row| {
        let name: String = row.get(1)?;
        let file: String = row.get(2)?;
        if name == "main" { Ok(file) } else { Ok(String::new()) }
    }).unwrap_or_default();
    
    if !agent_db_path.is_empty() {
        content_db.execute(&format!("ATTACH DATABASE '{}' AS agent", agent_db_path), [])?;
        
        content_db.execute("INSERT OR IGNORE INTO sections (id, document_id, parent_id, title, depth_level, sort_order) SELECT id, document_id, NULL, title, depth_level, sort_order FROM agent.agent_sections", [])?;
        content_db.execute("INSERT OR IGNORE INTO blocks (id, section_id, document_id, block_type, content, sort_order) SELECT id, section_id, document_id, block_type, content, sort_order FROM agent.agent_blocks", [])?;
        
        content_db.execute("DETACH DATABASE agent", [])?;
    }
    
    // Clean up temporary data in agent_db upon completion
    agent_db.execute("DROP TABLE IF EXISTS agent_conversation_history", [])?;
    agent_db.execute("DROP TABLE IF EXISTS agent_human_interactions", [])?;
    agent_db.execute("DROP TABLE IF EXISTS agent_block_tags", [])?;
    agent_db.execute("DROP TABLE IF EXISTS agent_tags", [])?;
    agent_db.execute("DROP TABLE IF EXISTS agent_blocks", [])?;
    agent_db.execute("DROP TABLE IF EXISTS agent_sections", [])?;
    agent_db.execute("DROP TABLE IF EXISTS agent_documents", [])?;
    
    Ok(())
}
