import Database from 'better-sqlite3';
import { RustParserBridge, ExtractedPage } from '../native/RustParserBridge';
import { runPass2Inference, ConnectorConfig, StructuringResponse } from '../api/connector';
import { PromptPayload } from '../api/prompts';
import { generateEmbedding } from '../utils/embeddings';
import { getPlainTextFromAST } from '../utils/ast';
import { MultiFormatExtraction } from '../shared/types/MultiFormatExtraction';

export interface ProcessJobOptions {
  db: Database.Database;
  documentId: string;
  filePath: string;
  config: ConnectorConfig;
}

/**
 * Transforms standard LLMStructuringOutput into Unified MultiFormatExtraction schema
 */
function transformLLMOutputToMultiFormat(
  documentId: string,
  pageNumber: number,
  output: StructuringResponse,
  extractedImages: any[],
  chunkId: string
): MultiFormatExtraction {
  const sections: any[] = [];
  const blocks: any[] = [];
  
  let currentSectionId = `sec-${documentId}-default`;
  let sectionSortOrder = pageNumber * 100;
  
  output.blocks.forEach((block, idx) => {
    const blockId = `block-${chunkId}-${idx}`;
    let blockSectionId = currentSectionId;
    
    if (block.block_type === 'heading') {
      const headingTitle = getPlainTextFromAST(typeof block.content === 'string' ? block.content : JSON.stringify(block.content)) || `Chapter ${pageNumber}`;
      const sectionId = `sec-${documentId}-${chunkId}-${idx}`;
      
      sections.push({
        id: sectionId,
        parent_id: null,
        title: headingTitle,
        depth_level: 1,
        sort_order: sectionSortOrder++,
      });
      
      currentSectionId = sectionId;
      blockSectionId = sectionId;
    }
    
    let contentStr = '';
    if (block.content) {
      contentStr = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
    } else if ((block as any).html_content) {
      contentStr = JSON.stringify({
        type: block.block_type === 'heading' ? 'heading' : 'paragraph',
        level: block.block_type === 'heading' ? 2 : undefined,
        children: [{
          type: 'text',
          text: String((block as any).html_content).replace(/<[^>]*>/g, ''),
          bold: null,
          italic: null,
          code: null
        }]
      });
    } else {
      contentStr = JSON.stringify({
        type: 'paragraph',
        children: []
      });
    }
    
    blocks.push({
      id: blockId,
      section_id: blockSectionId,
      block_type: block.block_type,
      content: contentStr,
      sort_order: idx,
      semantic_tags: block.semantic_tags || [],
    });
  });
  
  return {
    document_id: documentId,
    source_type: 'pdf',
    title: 'PDF Page',
    author: null,
    sections,
    blocks,
    extracted_images: extractedImages || [],
  };
}

/**
 * High-performance Background Processing Worker.
 * Executes Pass 1 JSI layout extraction, segments content into resilient job chunks,
 * routes segments through the structuring LLM, and inserts XHTML blocks into SQLite within a transaction.
 * 
 * Supports full checkpoint resumption to restart gracefully after application terminations.
 */
export async function processDocumentJob({
  db,
  documentId,
  filePath,
  config,
}: ProcessJobOptions): Promise<string> {
  const jobId = `job-${documentId}`;

  // 1. Check for an existing job to enable fault-tolerant resumption
  const existingJob: any = db.prepare('SELECT * FROM processing_jobs WHERE id = ?;').get(jobId);

  if (existingJob) {
    if (existingJob.status === 'completed') {
      console.log(`[Worker] Job ${jobId} is already completed. Skipping.`);
      return jobId;
    }
    console.log(`[Worker] Resuming existing job ${jobId} from checkpoint status: ${existingJob.status}`);
  }

  // 2. Initialize or Update Relational Background Job state without triggering ON DELETE CASCADE
  if (existingJob) {
    db.prepare(`
      UPDATE processing_jobs 
      SET status = 'processing', updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?;
    `).run(jobId);
  } else {
    db.prepare(`
      INSERT INTO processing_jobs (id, document_id, status, progress_percentage, created_at, updated_at)
      VALUES (?, ?, 'processing', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    `).run(jobId, documentId);
  }

  // Fetch document metadata to determine source type
  const docMeta: any = db.prepare('SELECT * FROM documents WHERE id = ?;').get(documentId);
  const sourceType = docMeta?.source_type || 'pdf';

  if (sourceType !== 'pdf') {
    console.log(`[Worker] Statically extracting structured content for source_type: ${sourceType}`);
    try {
      const extractionJson = await RustParserBridge.parsePDFAsync(filePath);
      const parsed = JSON.parse(extractionJson);
      
      const sections = parsed.sections || [];
      const blocks = parsed.blocks || [];
      
      // Pre-compute block insertions to separate heavy calculation (embeddings, highlight scans, AST serialization) from the SQLite write transaction
      const processedBlocks = blocks.map((block: any) => {
        let contentJson = block.content;
        if (typeof contentJson !== 'string' || !contentJson.trim().startsWith('{')) {
          contentJson = JSON.stringify({
            type: 'paragraph',
            children: [{
              type: 'text',
              text: String(block.content || '').replace(/<[^>]*>/g, ''),
              bold: null,
              italic: null,
              code: null
            }]
          });
        }

        const plainTextContent = getPlainTextFromAST(contentJson);
        const embeddingVector = generateEmbedding(plainTextContent);

        const floatVec = new Float32Array(embeddingVector);
        let bindValue: any = new Uint8Array(floatVec.buffer, floatVec.byteOffset, floatVec.byteLength);
        if (typeof Buffer !== 'undefined') {
          bindValue = Buffer.from(floatVec.buffer, floatVec.byteOffset, floatVec.byteLength);
        }

        const cleanTags: string[] = [];
        if (block.semantic_tags) {
          block.semantic_tags.forEach((tagName: string) => {
            const cleanTag = tagName.toLowerCase().trim();
            if (cleanTag) {
              cleanTags.push(cleanTag);
            }
          });
        }

        const highlights: string[] = [];
        const highlightRegex = /<span class="highlight">([\s\S]*?)<\/span>|<mark>([\s\S]*?)<\/mark>/g;
        let match;
        const plainText = getPlainTextFromAST(block.content || contentJson);
        while ((match = highlightRegex.exec(plainText)) !== null) {
          const text = (match[1] || match[2] || '').replace(/<[^>]*>/g, '').trim();
          if (text) {
            highlights.push(text);
          }
        }

        return {
          id: block.id,
          section_id: block.section_id,
          block_type: block.block_type,
          content: contentJson,
          sort_order: block.sort_order,
          bindValue,
          cleanTags,
          highlights,
        };
      });

      const runTransaction = db.transaction(() => {
        // Cascade delete existing sections and blocks (enforced by foreign keys)
        db.prepare('DELETE FROM sections WHERE document_id = ?;').run(documentId);

        // Write the extracted hierarchical TOC nodes into the sections table
        sections.forEach((sec: any) => {
          db.prepare(`
            INSERT INTO sections (id, document_id, parent_id, title, depth_level, sort_order)
            VALUES (?, ?, ?, ?, ?, ?);
          `).run(sec.id, documentId, sec.parent_id, sec.title, sec.depth_level, sec.sort_order);
        });

        // Write sequential XHTML blocks
        processedBlocks.forEach((b: any) => {
          db.prepare(`
            INSERT INTO blocks (id, section_id, document_id, block_type, content, sort_order)
            VALUES (?, ?, ?, ?, ?, ?);
          `).run(b.id, b.section_id, documentId, b.block_type, b.content, b.sort_order);

          db.prepare(`
            INSERT OR REPLACE INTO vector_cache (block_id, vector)
            VALUES (?, ?);
          `).run(b.id, b.bindValue);

          b.cleanTags.forEach((cleanTag: string) => {
            const tagId = `tag-${cleanTag}`;
            db.prepare(`
              INSERT OR IGNORE INTO tags (id, name, source)
              VALUES (?, ?, 'llm');
            `).run(tagId, cleanTag);

            db.prepare(`
              INSERT OR IGNORE INTO block_tags (block_id, tag_id)
              VALUES (?, ?);
            `).run(b.id, tagId);
          });

          b.highlights.forEach((text: string, idx: number) => {
            const annotationId = `ann-${b.id}-${idx}`;
            db.prepare(`
              INSERT OR IGNORE INTO annotations (id, document_id, block_id, annotation_type, highlighted_text)
              VALUES (?, ?, ?, 'highlight', ?);
            `).run(annotationId, documentId, b.id, text);
          });
        });

        // Write a completed job chunk to represent progress completion
        const chunkId = `chunk-${jobId}-static`;
        db.prepare(`
          INSERT OR REPLACE INTO job_chunks (id, job_id, raw_text, chunk_order, status, processed_blocks)
          VALUES (?, ?, ?, 1, 'completed', ?);
        `).run(chunkId, jobId, extractionJson, JSON.stringify({ blocks }));

        // Mark Job as Completed
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

  try {
    // 3. Fetch existing chunks to determine if we should resume from active segments
    let chunks: any[] = db.prepare('SELECT * FROM job_chunks WHERE job_id = ? ORDER BY chunk_order ASC;').all(jobId);

    if (chunks.length === 0) {
      console.log(`[Worker] No chunks found for job ${jobId}. Executing Pass 1 JSI Extraction...`);
      
      // Pass 1: High-Performance Native Parsing
      const extractionJson = await RustParserBridge.parsePDFAsync(filePath);
      const parsedExtraction = JSON.parse(extractionJson);
      
      // Normalize single pages or multi-page arrays
      const extractions: ExtractedPage[] = Array.isArray(parsedExtraction) ? parsedExtraction : [parsedExtraction];

      // Create Chunk segments in job_chunks for fault-tolerant state tracking
      for (const ext of extractions) {
        const chunkId = `chunk-${jobId}-${ext.page_number}`;
        // Store the full ExtractedPage JSON payload in raw_text so we don't lose any page metadata
        db.prepare(`
          INSERT OR REPLACE INTO job_chunks (id, job_id, raw_text, chunk_order, status)
          VALUES (?, ?, ?, ?, 'pending');
        `).run(chunkId, jobId, JSON.stringify(ext), ext.page_number);
      }

      // Re-fetch created chunks
      chunks = db.prepare('SELECT * FROM job_chunks WHERE job_id = ? ORDER BY chunk_order ASC;').all(jobId);
    } else {
      console.log(`[Worker] Loaded ${chunks.length} job chunks from previous session database checkpoint.`);
    }

    const totalChunksCount = chunks.length;

    // 4. Progressively process each incomplete chunk
    for (const chunk of chunks) {
      if (chunk.status === 'completed') {
        console.log(`[Worker] Chunk ${chunk.id} already processed. Skipping.`);
        continue;
      }

      console.log(`[Worker] Processing chunk ${chunk.id} (Order: ${chunk.chunk_order})...`);
      db.prepare(`UPDATE job_chunks SET status = 'processing' WHERE id = ?;`).run(chunk.id);

      // Deserialize chunk payload
      let page: ExtractedPage;
      try {
        const parsedText = JSON.parse(chunk.raw_text);
        if (parsedText && typeof parsedText === 'object' && 'raw_text' in parsedText) {
          page = parsedText;
        } else {
          page = {
            document_id: documentId,
            page_number: chunk.chunk_order,
            overlap_context: '',
            raw_text: chunk.raw_text,
            layout_hints: [],
          };
        }
      } catch {
        page = {
          document_id: documentId,
          page_number: chunk.chunk_order,
          overlap_context: '',
          raw_text: chunk.raw_text,
          layout_hints: [],
        };
      }

      // 5. Run Pass 2: Structured Layout LLM Connector / Delineator
      let pageExtraction: MultiFormatExtraction;
      if (config.route === 'local') {
        const modelPath = config.modelName || 'models/custom-model.gguf';
        try {
          const resJson = await RustParserBridge.delineatePageAsync(JSON.stringify(page), modelPath);
          pageExtraction = JSON.parse(resJson);
        } catch (err) {
          db.prepare(`UPDATE job_chunks SET status = 'failed' WHERE id = ?;`).run(chunk.id);
          throw err;
        }
      } else {
        const payload: PromptPayload = {
          document_id: documentId,
          page_number: page.page_number,
          overlap_context: page.overlap_context,
          raw_text: page.raw_text,
          layout_hints: page.layout_hints,
        };

        let structuringOutput: StructuringResponse;
        try {
          structuringOutput = await runPass2Inference(payload, config);
        } catch (err) {
          db.prepare(`UPDATE job_chunks SET status = 'failed' WHERE id = ?;`).run(chunk.id);
          throw err;
        }

        pageExtraction = transformLLMOutputToMultiFormat(documentId, page.page_number, structuringOutput, page.extracted_images || [], chunk.id);
      }

      // Pre-compute block insertions to separate heavy calculation (embeddings, highlight scans) from the SQLite write transaction
      const processedPdfBlocks = pageExtraction.blocks.map((block) => {
        const plainTextContent = getPlainTextFromAST(block.content);
        const embeddingVector = generateEmbedding(plainTextContent);

        const floatVec = new Float32Array(embeddingVector);
        let bindValue: any = new Uint8Array(floatVec.buffer, floatVec.byteOffset, floatVec.byteLength);
        if (typeof Buffer !== 'undefined') {
          bindValue = Buffer.from(floatVec.buffer, floatVec.byteOffset, floatVec.byteLength);
        }

        const cleanTags: string[] = [];
        if (block.semantic_tags) {
          block.semantic_tags.forEach((tagName) => {
            const cleanTag = tagName.toLowerCase().trim();
            if (cleanTag) {
              cleanTags.push(cleanTag);
            }
          });
        }

        const highlights: string[] = [];
        const highlightRegex = /<span class="highlight">([\s\S]*?)<\/span>|<mark>([\s\S]*?)<\/mark>/g;
        let match;
        const plainText = getPlainTextFromAST(block.content);
        while ((match = highlightRegex.exec(plainText)) !== null) {
          const text = (match[1] || match[2] || '').replace(/<[^>]*>/g, '').trim();
          if (text) {
            highlights.push(text);
          }
        }

        return {
          id: block.id,
          section_id: block.section_id,
          block_type: block.block_type,
          content: block.content,
          sort_order: block.sort_order,
          bindValue,
          cleanTags,
          highlights,
        };
      });

      // 6. DB Insertion Transaction to enforce relational integrity and trigger FTS5
      const runTransaction = db.transaction(() => {
        // Ensure default section exists for orphan blocks
        db.prepare(`
          INSERT OR IGNORE INTO sections (id, document_id, title, sort_order, depth_level)
          VALUES (?, ?, 'Default Section', 0, 1);
        `).run(`sec-${documentId}-default`, documentId);

        // Write the sections from pageExtraction
        pageExtraction.sections.forEach((sec) => {
          db.prepare(`
            INSERT OR IGNORE INTO sections (id, document_id, parent_id, title, depth_level, sort_order)
            VALUES (?, ?, ?, ?, ?, ?);
          `).run(sec.id, documentId, sec.parent_id, sec.title, sec.depth_level, sec.sort_order);
        });

        // Write sequential XHTML blocks using pre-computed values
        processedPdfBlocks.forEach((b) => {
          db.prepare(`
            INSERT INTO blocks (id, section_id, document_id, block_type, content, sort_order)
            VALUES (?, ?, ?, ?, ?, ?);
          `).run(b.id, b.section_id, documentId, b.block_type, b.content, b.sort_order);

          db.prepare(`
            INSERT OR REPLACE INTO vector_cache (block_id, vector)
            VALUES (?, ?);
          `).run(b.id, b.bindValue);

          b.cleanTags.forEach((cleanTag) => {
            const tagId = `tag-${cleanTag}`;
            db.prepare(`
              INSERT OR IGNORE INTO tags (id, name, source)
              VALUES (?, ?, 'llm');
            `).run(tagId, cleanTag);

            db.prepare(`
              INSERT OR IGNORE INTO block_tags (block_id, tag_id)
              VALUES (?, ?);
            `).run(b.id, tagId);
          });

          b.highlights.forEach((text, idx) => {
            const annotationId = `ann-${b.id}-${idx}`;
            db.prepare(`
              INSERT OR IGNORE INTO annotations (id, document_id, block_id, annotation_type, highlighted_text)
              VALUES (?, ?, ?, 'highlight', ?);
            `).run(annotationId, documentId, b.id, text);
          });
        });

        // Update chunk status and save the final payload
        db.prepare(`
          UPDATE job_chunks 
          SET status = 'completed', processed_blocks = ? 
          WHERE id = ?;
        `).run(JSON.stringify(pageExtraction), chunk.id);

        // Update progress percentage
        const completed: any = db.prepare(`
          SELECT COUNT(*) as count FROM job_chunks WHERE job_id = ? AND status = 'completed';
        `).get(jobId);
        
        const progress = Math.round((completed.count / totalChunksCount) * 100);
        db.prepare(`
          UPDATE processing_jobs 
          SET progress_percentage = ?, updated_at = CURRENT_TIMESTAMP 
          WHERE id = ?;
        `).run(progress, jobId);
      });

      runTransaction();
    }

    // 7. Mark Job as Completed
    db.prepare(`
      UPDATE processing_jobs 
      SET status = 'completed', progress_percentage = 100, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?;
    `).run(jobId);

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
