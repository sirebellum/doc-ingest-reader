import Database from 'better-sqlite3';
import { RustParserBridge, ExtractedPage } from '../native/RustParserBridge';
import { runPass2Inference, ConnectorConfig, StructuringResponse } from '../api/connector';
import { PromptPayload } from '../api/prompts';

export interface ProcessJobOptions {
  db: Database.Database;
  documentId: string;
  filePath: string;
  config: ConnectorConfig;
}

/**
 * High-performance Background Processing Worker.
 * Executes Pass 1 JSI layout extraction, segments content into resilient job chunks,
 * routes segments through the structuring LLM, and inserts XHTML blocks into SQLite within a transaction.
 */
export async function processDocumentJob({
  db,
  documentId,
  filePath,
  config,
}: ProcessJobOptions): Promise<string> {
  const jobId = `job-${documentId}`;

  // 1. Initialize Relational Background State Job
  db.prepare(`
    INSERT OR REPLACE INTO processing_jobs (id, document_id, status, progress_percentage)
    VALUES (?, ?, 'processing', 0);
  `).run(jobId, documentId);

  try {
    // 2. Pass 1: High-Performance Native Parsing
    const extractionJson = await RustParserBridge.parsePDFAsync(filePath);
    const extraction: ExtractedPage = JSON.parse(extractionJson);

    // 3. Create Chunk segments in job_chunks for fault-tolerant state tracking
    const chunkId = `chunk-${jobId}-1`;
    db.prepare(`
      INSERT OR REPLACE INTO job_chunks (id, job_id, raw_text, chunk_order, status)
      VALUES (?, ?, ?, 1, 'pending');
    `).run(chunkId, jobId, extraction.raw_text);

    // 4. Update Chunk to processing
    db.prepare(`UPDATE job_chunks SET status = 'processing' WHERE id = ?;`).run(chunkId);

    // 5. Run Pass 2: Structured Layout LLM Connector
    const payload: PromptPayload = {
      document_id: documentId,
      page_number: extraction.page_number,
      overlap_context: extraction.overlap_context,
      raw_text: extraction.raw_text,
      layout_hints: extraction.layout_hints.map((hint) => ({
        bounding_box: hint.bounding_box,
        font_size: hint.font_size,
        text_snippet: hint.text_snippet,
      })),
    };

    const structuringOutput: StructuringResponse = await runPass2Inference(payload, config);

    // 6. DB Insertion Transaction to enforce relational integrity and trigger FTS5
    const runTransaction = db.transaction(() => {
      // Create a default Section if none exists
      const sectionId = `sec-${documentId}-1`;
      db.prepare(`
        INSERT OR IGNORE INTO sections (id, document_id, title, sort_order)
        VALUES (?, ?, 'Chapter 1', 1);
      `).run(sectionId, documentId);

      // Insert individual blocks
      structuringOutput.blocks.forEach((block, idx) => {
        const blockId = `block-${jobId}-${idx}`;
        db.prepare(`
          INSERT INTO blocks (id, section_id, document_id, block_type, content, sort_order)
          VALUES (?, ?, ?, ?, ?, ?);
        `).run(blockId, sectionId, documentId, block.block_type, block.html_content, idx);

        // Manage semantic tags and block mappings
        block.semantic_tags.forEach((tagName) => {
          const cleanTag = tagName.toLowerCase().trim();
          const tagId = `tag-${cleanTag}`;
          db.prepare(`
            INSERT OR IGNORE INTO tags (id, name, source)
            VALUES (?, ?, 'llm');
          `).run(tagId, cleanTag);

          db.prepare(`
            INSERT OR IGNORE INTO block_tags (block_id, tag_id)
            VALUES (?, ?);
          `).run(blockId, tagId);
        });
      });

      // Update chunk status and save the final payload
      db.prepare(`
        UPDATE job_chunks 
        SET status = 'completed', processed_blocks = ? 
        WHERE id = ?;
      `).run(JSON.stringify(structuringOutput), chunkId);

      // Update job to 100% completed
      db.prepare(`
        UPDATE processing_jobs 
        SET status = 'completed', progress_percentage = 100, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?;
      `).run(jobId);
    });

    runTransaction();
    return jobId;
  } catch (error) {
    db.prepare(`
      UPDATE processing_jobs 
      SET status = 'failed', updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?;
    `).run(jobId);
    throw error;
  }
}
