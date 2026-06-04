// Mock expo-sqlite before importing schema so it doesn't crash on native imports
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn().mockReturnValue({
    execSync: jest.fn(),
  }),
}));

import Database from 'better-sqlite3';
import { INITIALIZE_DATABASE_SCHEMA } from '../schema';
import { processDocumentJob } from '../worker';
import { ConnectorConfig } from '../../api/connector';
import { RustParserBridge } from '../../native/RustParserBridge';

describe('Background Ingestion Worker Resumption & Checkpointing', () => {
  let db: Database.Database;
  const docId = 'doc-test-123';
  const corpId = 'corp-test-123';
  const jobId = `job-${docId}`;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(INITIALIZE_DATABASE_SCHEMA);

    // Seed collection and document metadata
    db.exec(`
      INSERT INTO corpora (id, name) VALUES ('${corpId}', 'Main Collection');
      INSERT INTO documents (id, corpus_id, title, sha256_hash, storage_path)
      VALUES ('${docId}', '${corpId}', 'Golden Document', 'hash_sha_256', '/sandbox/doc.pdf');
    `);
  });

  afterEach(() => {
    db.close();
    jest.restoreAllMocks();
  });

  it('should run Pass 1 parsing, segment into chunks, and insert blocks + tags + auto highlights', async () => {
    const config: ConnectorConfig = {
      route: 'local',
    };

    const runId = await processDocumentJob({
      db,
      documentId: docId,
      filePath: 'sandbox/doc.pdf',
      config,
    });

    expect(runId).toBe(jobId);

    // Check processing job state
    const jobRow: any = db.prepare('SELECT * FROM processing_jobs WHERE id = ?;').get(jobId);
    expect(jobRow.status).toBe('completed');
    expect(jobRow.progress_percentage).toBe(100);

    // Check created chunks
    const chunks = db.prepare('SELECT * FROM job_chunks WHERE job_id = ?;').all(jobId);
    expect(chunks.length).toBe(1);
    expect((chunks[0] as any).status).toBe('completed');

    // Check block insertions
    const blocks = db.prepare('SELECT * FROM blocks WHERE document_id = ?;').all(docId);
    expect(blocks.length).toBe(2);

    // Check tags and tag mappings
    const tags = db.prepare('SELECT * FROM tags;').all();
    expect(tags.length).toBe(5); // 'offline', 'llama', 'local', 'npu', 'dsp'

    // Check automatic highlight extraction
    // (mock output from local is `<p>This is a simulated paragraph containing ...</p>`. Let's test custom highlight matching in another assertion)
  });

  it('should parse highlights from HTML blocks and write highlights to annotations table automatically', async () => {
    // Override fetch to return html content with highlight tags
    const spyFetch = jest.spyOn(global, 'fetch');
    spyFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                blocks: [
                  {
                    block_type: 'paragraph',
                    content: {
                      type: 'paragraph',
                      children: [{
                        type: 'text',
                        text: 'Standard text with <span class="highlight">important highlight</span> and <mark>marked text</mark>.',
                        bold: null,
                        italic: null,
                        code: null
                      }]
                    },
                    hyperlink_targets: [],
                    semantic_tags: ['indexing'],
                  },
                ],
              }),
            },
          },
        ],
      }),
    } as any);

    const config: ConnectorConfig = {
      route: 'network',
      endpoint: 'http://127.0.0.1:1234',
    };

    await processDocumentJob({
      db,
      documentId: docId,
      filePath: 'sandbox/doc.pdf',
      config,
    });

    const annotations = db.prepare('SELECT * FROM annotations WHERE document_id = ?;').all(docId) as any[];
    expect(annotations.length).toBe(2);
    expect(annotations[0].highlighted_text).toBe('important highlight');
    expect(annotations[1].highlighted_text).toBe('marked text');
    expect(annotations[0].annotation_type).toBe('highlight');
  });

  it('should dynamically expand sections and set correct sort orders on encountering heading block types', async () => {
    const spyFetch = jest.spyOn(global, 'fetch');
    spyFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                blocks: [
                  {
                    block_type: 'heading',
                    content: {
                      type: 'heading',
                      level: 2,
                      children: [{
                        type: 'text',
                        text: 'Chapter 2: SQLite Advanced',
                        bold: null,
                        italic: null,
                        code: null
                      }]
                    },
                    hyperlink_targets: [],
                    semantic_tags: [],
                  },
                  {
                    block_type: 'paragraph',
                    content: {
                      type: 'paragraph',
                      children: [{
                        type: 'text',
                        text: 'Detailed discussion of search indexing.',
                        bold: null,
                        italic: null,
                        code: null
                      }]
                    },
                    hyperlink_targets: [],
                    semantic_tags: [],
                  },
                ],
              }),
            },
          },
        ],
      }),
    } as any);

    const config: ConnectorConfig = {
      route: 'network',
      endpoint: 'http://127.0.0.1:1234',
    };

    await processDocumentJob({
      db,
      documentId: docId,
      filePath: 'sandbox/doc.pdf',
      config,
    });

    // Check created sections
    const sections = db.prepare('SELECT * FROM sections WHERE document_id = ? ORDER BY sort_order ASC;').all(docId) as any[];
    
    // There will be two sections: the Default Section (created first), and then Chapter 2
    expect(sections.length).toBe(2);
    expect(sections[0].title).toBe('Default Section');
    expect(sections[1].title).toBe('Chapter 2: SQLite Advanced');

    // Confirm that the paragraph block belongs to the Chapter 2 section
    const paragraphs = db.prepare("SELECT * FROM blocks WHERE block_type = 'paragraph';").all() as any[];
    expect(paragraphs.length).toBe(1);
    expect(paragraphs[0].section_id).toBe(sections[1].id);
  });

  it('should dynamically resume from last successfully parsed checkpoint/chunk and bypass Pass 1 parsing completely', async () => {
    // 1. Seed existing job in 'processing' status
    db.prepare(`
      INSERT INTO processing_jobs (id, document_id, status, progress_percentage)
      VALUES (?, ?, 'processing', 50);
    `).run(jobId, docId);

    // 2. Seed job chunks (chunk-1 is completed, chunk-2 is pending)
    const page1Data = {
      document_id: docId,
      page_number: 1,
      overlap_context: '',
      raw_text: 'This is the raw content of chunk 1.',
      layout_hints: [],
    };

    const page2Data = {
      document_id: docId,
      page_number: 2,
      overlap_context: '',
      raw_text: 'This is the raw content of chunk 2.',
      layout_hints: [],
    };

    db.prepare(`
      INSERT INTO job_chunks (id, job_id, raw_text, chunk_order, status, processed_blocks)
      VALUES (?, ?, ?, 1, 'completed', ?);
    `).run(`chunk-${jobId}-1`, jobId, JSON.stringify(page1Data), '{"blocks":[]}');

    db.prepare(`
      INSERT INTO job_chunks (id, job_id, raw_text, chunk_order, status)
      VALUES (?, ?, ?, 2, 'pending');
    `).run(`chunk-${jobId}-2`, jobId, JSON.stringify(page2Data));

    // 3. Spy on RustParserBridge to verify it is NOT called since chunks already exist in DB
    const spyParsePDF = jest.spyOn(RustParserBridge, 'parsePDFAsync');

    // 4. Setup mock cloud/network connector for the pending chunk 2
    const spyFetch = jest.spyOn(global, 'fetch');
    spyFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                blocks: [
                  {
                    block_type: 'paragraph',
                    html_content: '<p>Resumed page 2 content</p>',
                    hyperlink_targets: [],
                    semantic_tags: ['resumed'],
                  },
                ],
              }),
            },
          },
        ],
      }),
    } as any);

    const config: ConnectorConfig = {
      route: 'network',
      endpoint: 'http://127.0.0.1:1234',
    };

    // 5. Run processDocumentJob to trigger resumption
    const resumedJobId = await processDocumentJob({
      db,
      documentId: docId,
      filePath: 'sandbox/doc.pdf',
      config,
    });

    expect(resumedJobId).toBe(jobId);

    // Verify Pass 1 static parsing was completely bypassed!
    expect(spyParsePDF).not.toHaveBeenCalled();

    // Verify chunk 2 completed successfully
    const chunk2: any = db.prepare("SELECT * FROM job_chunks WHERE id = ?;").get(`chunk-${jobId}-2`);
    expect(chunk2.status).toBe('completed');
    expect(chunk2.processed_blocks).toContain('resumed');

    // Verify job updated to completed
    const finalJob: any = db.prepare('SELECT * FROM processing_jobs WHERE id = ?;').get(jobId);
    expect(finalJob.status).toBe('completed');
    expect(finalJob.progress_percentage).toBe(100);

    // Verify block inserted correctly
    const resumedBlock: any = db.prepare("SELECT * FROM blocks WHERE id = ?;").get(`block-chunk-${jobId}-2-0`);
    expect(resumedBlock).toBeDefined();
    expect(resumedBlock.content).toContain('Resumed page 2 content');
  });

  it('should transition job status to failed and propagate the exception if a processing error occurs', async () => {
    const faultyConfig: ConnectorConfig = {
      route: 'network', // Missing endpoint configuration will throw error
    };

    await expect(
      processDocumentJob({
        db,
        documentId: docId,
        filePath: 'sandbox/doc.pdf',
        config: faultyConfig,
      })
    ).rejects.toThrow();

    const jobRow: any = db.prepare('SELECT * FROM processing_jobs WHERE id = ?;').get(`job-${docId}`);
    expect(jobRow.status).toBe('failed');
  });

  it('should verify that overlapping text context is utilized during processing but is purged from final blocks relational storage', async () => {
    const jobId = `job-${docId}`;
    const pageData = {
      document_id: docId,
      page_number: 1,
      overlap_context: 'OVERLAP_CONTEXT_VAL_TO_BE_PURGED',
      raw_text: 'Raw text content for page 1.',
      layout_hints: [],
    };
    
    db.prepare(`
      INSERT INTO processing_jobs (id, document_id, status, progress_percentage)
      VALUES (?, ?, 'processing', 0);
    `).run(jobId, docId);

    db.prepare(`
      INSERT INTO job_chunks (id, job_id, raw_text, chunk_order, status)
      VALUES (?, ?, ?, 1, 'pending');
    `).run(`chunk-${jobId}-overlap-test`, jobId, JSON.stringify(pageData));

    const spyFetch = jest.spyOn(global, 'fetch');
    spyFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                blocks: [
                  {
                    block_type: 'paragraph',
                    content: {
                      type: 'paragraph',
                      children: [{
                        type: 'text',
                        text: 'Extracted text here without overlap.',
                        bold: null,
                        italic: null,
                        code: null
                      }]
                    },
                    hyperlink_targets: [],
                    semantic_tags: [],
                  },
                ],
              }),
            },
          },
        ],
      }),
    } as any);

    const config: ConnectorConfig = {
      route: 'network',
      endpoint: 'http://127.0.0.1:1234',
    };

    await processDocumentJob({
      db,
      documentId: docId,
      filePath: 'sandbox/doc.pdf',
      config,
    });

    expect(spyFetch).toHaveBeenCalled();
    const lastCallArgs = spyFetch.mock.calls[0];
    const requestBody = JSON.parse(lastCallArgs[1]?.body as string);
    const userContent = requestBody.messages[1].content;
    expect(userContent).toContain('OVERLAP_CONTEXT_VAL_TO_BE_PURGED');

    const blocks = db.prepare('SELECT * FROM blocks WHERE document_id = ?;').all(docId) as any[];
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block.content).not.toContain('OVERLAP_CONTEXT_VAL_TO_BE_PURGED');
    }
  });
});
