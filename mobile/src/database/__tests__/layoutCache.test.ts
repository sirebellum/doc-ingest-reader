jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn().mockReturnValue({
    execSync: jest.fn(),
  }),
}));

import Database from 'better-sqlite3';
import { INITIALIZE_DATABASE_SCHEMA } from '../schema';
import { estimateBlockHeight, getOrCacheBlockHeight, Block } from '../layoutCache';

describe('XHTML Layout Height Caching & Estimation', () => {
  let db: Database.Database;

  const blockHeading: Block = {
    id: 'b-head',
    section_id: 'sec-1',
    document_id: 'doc-1',
    block_type: 'heading',
    content: '<h2>Chapter 1: Dynamic Recyclers</h2>',
    sort_order: 1,
  };

  const blockCode: Block = {
    id: 'b-code',
    section_id: 'sec-1',
    document_id: 'doc-1',
    block_type: 'code',
    content: '<pre><code>const a = 1;\nconst b = 2;\nconsole.log(a + b);</code></pre>',
    sort_order: 2,
  };

  const blockTable: Block = {
    id: 'b-table',
    section_id: 'sec-1',
    document_id: 'doc-1',
    block_type: 'table',
    content: '<table><tr><td>A</td></tr><tr><td>B</td></tr></table>',
    sort_order: 3,
  };

  const blockImage: Block = {
    id: 'b-img',
    section_id: 'sec-1',
    document_id: 'doc-1',
    block_type: 'paragraph',
    content: '<p>An image <img src="local-asset://img1.png" /> caption</p>',
    sort_order: 4,
  };

  const blockParagraph: Block = {
    id: 'b-para',
    section_id: 'sec-1',
    document_id: 'doc-1',
    block_type: 'paragraph',
    content: '<p>A moderately long paragraph detailing how mobile devices render pages.</p>',
    sort_order: 5,
  };

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(INITIALIZE_DATABASE_SCHEMA);

    // Seed required tables for foreign key cascades
    db.prepare("INSERT INTO corpora (id, name) VALUES ('corp-1', 'Main Corpus');").run();
    db.prepare("INSERT INTO documents (id, corpus_id, title, author, sha256_hash, storage_path) VALUES ('doc-1', 'corp-1', 'Test Book', 'Test Author', 'sha256_mock', '/path.pdf');").run();
    db.prepare("INSERT INTO sections (id, document_id, title, sort_order) VALUES ('sec-1', 'doc-1', 'Ch 1', 1);").run();
    
    // Seed blocks to allow layout_height_cache inserts
    for (const b of [blockHeading, blockCode, blockTable, blockImage, blockParagraph]) {
      db.prepare("INSERT INTO blocks (id, section_id, document_id, block_type, content, sort_order) VALUES (?, ?, ?, ?, ?, ?);")
        .run(b.id, b.section_id, b.document_id, b.block_type, b.content, b.sort_order);
    }
  });

  afterEach(() => {
    db.close();
  });

  describe('XHTML Height Estimation Rules', () => {
    it('should estimate a fixed height for heading blocks', () => {
      const height = estimateBlockHeight(blockHeading);
      expect(height).toBe(60);
    });

    it('should estimate height based on lines of code in code blocks', () => {
      const height = estimateBlockHeight(blockCode);
      expect(height).toBe(3 * 20 + 32); // 3 lines
    });

    it('should estimate height based on table rows in table blocks', () => {
      const height = estimateBlockHeight(blockTable);
      expect(height).toBe(2 * 40 + 36); // 2 rows
    });

    it('should estimate a large base height for visual image blocks', () => {
      const height = estimateBlockHeight(blockImage);
      expect(height).toBe(300);
    });

    it('should estimate height proportional to string length for paragraph blocks', () => {
      const height = estimateBlockHeight(blockParagraph);
      // charCount is ~59 chars -> 1 line -> 1 * 24 + 20 = 44
      expect(height).toBe(44);
    });
  });

  describe('SQLite Cache Integration', () => {
    it('should calculate, write to cache on first call, and retrieve from cache on subsequent calls', () => {
      // First call -> should compute height (60) and insert into layout_height_cache
      const height1 = getOrCacheBlockHeight(db, blockHeading);
      expect(height1).toBe(60);

      // Verify the record is present in SQLite
      const row = db.prepare('SELECT estimated_height FROM layout_height_cache WHERE block_id = ?;').get('b-head') as any;
      expect(row).toBeDefined();
      expect(row.estimated_height).toBe(60);

      // Let's modify the cache value directly in SQLite to verify that subsequent calls return the CACHED value, not recalculating
      db.prepare('UPDATE layout_height_cache SET estimated_height = ? WHERE block_id = ?;').run(150, 'b-head');

      const height2 = getOrCacheBlockHeight(db, blockHeading);
      expect(height2).toBe(150); // Returns cached value!
    });
  });
});
