// Mock expo-sqlite before importing schema so it doesn't crash on native imports in Jest Node environment
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn().mockReturnValue({
    execSync: jest.fn(),
  }),
}));

import Database from 'better-sqlite3';
import { INITIALIZE_DATABASE_SCHEMA } from '../schema';

describe('SQLite FTS5 Full-Text Search Integration & Sync Triggers', () => {
  let db: Database.Database;
  const corpId = 'corp-fts-test';
  const docId = 'doc-fts-test';
  const secId = 'sec-fts-test';

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(INITIALIZE_DATABASE_SCHEMA);

    // Seed relational structure
    db.prepare(`
      INSERT INTO corpora (id, name) VALUES (?, 'FTS Search Corpus');
    `).run(corpId);

    db.prepare(`
      INSERT INTO documents (id, corpus_id, title, sha256_hash, storage_path)
      VALUES (?, ?, 'FTS Integration Document', 'fts_doc_sha_256', '/sandbox/fts.pdf');
    `).run(docId, corpId);

    db.prepare(`
      INSERT INTO sections (id, document_id, title, sort_order)
      VALUES (?, ?, 'FTS Ingestion Chapter 1', 1);
    `).run(secId, docId);
  });

  afterEach(() => {
    db.close();
  });

  it('should automatically index blocks upon insertion via triggers', () => {
    const blockId = 'block-fts-1';
    const content = '<p>This is a core paragraph describing semantic full-text indexing in SQLite.</p>';

    db.prepare(`
      INSERT INTO blocks (id, section_id, document_id, block_type, content, sort_order)
      VALUES (?, ?, ?, 'paragraph', ?, 1);
    `).run(blockId, secId, docId, content);

    // Verify trigger copied block content to FTS5 virtual table
    const ftsRow: any = db.prepare('SELECT * FROM blocks_fts WHERE block_id = ?;').get(blockId);
    expect(ftsRow).toBeDefined();
    expect(ftsRow.content).toBe(content);

    // Verify standard search query matches keyword
    const searchMatch = db.prepare(`
      SELECT b.* FROM blocks b 
      JOIN blocks_fts fts ON b.id = fts.block_id 
      WHERE fts.content MATCH 'semantic';
    `).all();

    expect(searchMatch.length).toBe(1);
    expect((searchMatch[0] as any).id).toBe(blockId);
  });

  it('should automatically synchronize updates via the FTS5 update trigger', () => {
    const blockId = 'block-fts-2';
    const originalContent = '<p>Original text describing Rust parser bindings.</p>';
    const updatedContent = '<p>Updated text describing C++ JSI direct memory layout mappings.</p>';

    db.prepare(`
      INSERT INTO blocks (id, section_id, document_id, block_type, content, sort_order)
      VALUES (?, ?, ?, 'paragraph', ?, 2);
    `).run(blockId, secId, docId, originalContent);

    // Update block
    db.prepare(`
      UPDATE blocks SET content = ? WHERE id = ?;
    `).run(updatedContent, blockId);

    // Verify FTS table matches updated content
    const ftsRow: any = db.prepare('SELECT * FROM blocks_fts WHERE block_id = ?;').get(blockId);
    expect(ftsRow.content).toBe(updatedContent);

    // Verify matches updated keyword
    const matchUpdated = db.prepare(`
      SELECT * FROM blocks_fts WHERE content MATCH 'JSI';
    `).all();
    expect(matchUpdated.length).toBe(1);

    // Verify original keyword no longer matches
    const matchOriginal = db.prepare(`
      SELECT * FROM blocks_fts WHERE content MATCH 'Rust';
    `).all();
    expect(matchOriginal.length).toBe(0);
  });

  it('should automatically clean up FTS5 indexes when a block is deleted via triggers', () => {
    const blockId = 'block-fts-3';
    const content = '<p>Temporary block to be indexed and deleted.</p>';

    db.prepare(`
      INSERT INTO blocks (id, section_id, document_id, block_type, content, sort_order)
      VALUES (?, ?, ?, 'paragraph', ?, 3);
    `).run(blockId, secId, docId, content);

    // Verify it exists in FTS
    let ftsRow = db.prepare('SELECT * FROM blocks_fts WHERE block_id = ?;').get(blockId);
    expect(ftsRow).toBeDefined();

    // Delete block
    db.prepare('DELETE FROM blocks WHERE id = ?;').run(blockId);

    // Verify FTS record has been purged
    ftsRow = db.prepare('SELECT * FROM blocks_fts WHERE block_id = ?;').get(blockId);
    expect(ftsRow).toBeUndefined();
  });

  it('should perform range queries to isolate exact matched block scopes', () => {
    // Insert multiple blocks to represent a document layout stream
    const blocksData = [
      { id: 'b-1', text: '<p>The quick brown fox jumps over the lazy dog.</p>', order: 1 },
      { id: 'b-2', text: '<h2>Second Chapter Heading</h2>', order: 2 },
      { id: 'b-3', text: '<p>Standard indexing uses suffix arrays.</p>', order: 3 },
      { id: 'b-4', text: '<p>We can utilize a custom SQLite FTS5 parser.</p>', order: 4 },
    ];

    const insertStmt = db.prepare(`
      INSERT INTO blocks (id, section_id, document_id, block_type, content, sort_order)
      VALUES (?, ?, ?, 'paragraph', ?, ?);
    `);

    for (const b of blocksData) {
      insertStmt.run(b.id, secId, docId, b.text, b.order);
    }

    // Match query returning blocks
    const results = db.prepare(`
      SELECT b.id, b.sort_order 
      FROM blocks b
      JOIN blocks_fts fts ON b.id = fts.block_id
      WHERE fts.content MATCH 'indexing'
      ORDER BY b.sort_order ASC;
    `).all() as { id: string; sort_order: number }[];

    expect(results.length).toBe(1);
    expect(results[0].id).toBe('b-3');
    expect(results[0].sort_order).toBe(3);
  });
});
