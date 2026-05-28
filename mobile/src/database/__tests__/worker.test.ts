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

describe('Background Ingestion Worker Integration', () => {
  let db: Database.Database;
  const docId = 'doc-test-123';
  const corpId = 'corp-test-123';

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
  });

  it('should run Pass 1 parsing, division of chunks, LLM calls, and transactional insertions end-to-end', async () => {
    const config: ConnectorConfig = {
      route: 'local', // Mock route routes instantly
    };

    const jobId = await processDocumentJob({
      db,
      documentId: docId,
      filePath: 'sandbox/doc.pdf',
      config,
    });

    expect(jobId).toBe(`job-${docId}`);

    // Verify background tracking state
    const jobRow: any = db.prepare('SELECT * FROM processing_jobs WHERE id = ?;').get(jobId);
    expect(jobRow.status).toBe('completed');
    expect(jobRow.progress_percentage).toBe(100);

    const chunkRow: any = db.prepare('SELECT * FROM job_chunks WHERE job_id = ?;').get(jobId);
    expect(chunkRow.status).toBe('completed');
    expect(chunkRow.processed_blocks).toContain('simulated');

    // Verify atomic blocks relational insertions
    const blocks = db.prepare('SELECT * FROM blocks WHERE document_id = ?;').all(docId);
    expect(blocks.length).toBe(2);
    expect((blocks[0] as any).block_type).toBe('heading');
    expect((blocks[1] as any).block_type).toBe('paragraph');

    // Verify FTS5 automatic triggers sync
    const ftsRows = db.prepare("SELECT * FROM blocks_fts;").all();
    expect(ftsRows.length).toBe(2);

    // Verify lowercase normalized tag mapping and junction table
    const tags = db.prepare('SELECT * FROM tags;').all();
    expect(tags.length).toBe(3); // 'mock', 'scaffolding', 'simulated'
    
    const blockTags = db.prepare('SELECT * FROM block_tags;').all();
    expect(blockTags.length).toBe(3);
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
});
