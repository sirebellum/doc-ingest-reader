// Mock expo-sqlite before importing schema so it doesn't crash on native imports
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn().mockReturnValue({
    execSync: jest.fn(),
  }),
}));

import Database from 'better-sqlite3';
import { INITIALIZE_DATABASE_SCHEMA } from '../schema';

describe('Database Schema DDL & Triggers Verification', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('should compile the complete DDL schema and initialize all tables successfully', () => {
    // Run the schema on the real in-memory SQLite database
    expect(() => {
      db.exec(INITIALIZE_DATABASE_SCHEMA);
    }).not.toThrow();

    // Query sqlite_master to verify the created tables
    const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;");
    const tables: string[] = stmt.all().map((row: any) => row.name);

    // Check all required relational tables
    const expectedTables = [
      'annotations',
      'block_tags',
      'blocks',
      'blocks_fts', // Virtual FTS5 table
      'corpora',
      'documents',
      'job_chunks',
      'processing_jobs',
      'sections',
      'tags',
    ];

    expectedTables.forEach(table => {
      expect(tables).toContain(table);
    });
  });

  it('should compile and synchronize FTS5 index via the defined triggers', () => {
    // Initialize the schema
    db.exec(INITIALIZE_DATABASE_SCHEMA);

    // Insert mock data into blocks table
    db.exec(`
      INSERT INTO corpora (id, name) VALUES ('corp-1', 'My Corpus');
      INSERT INTO documents (id, corpus_id, title, sha256_hash, storage_path)
      VALUES ('doc-1', 'corp-1', 'Test PDF', 'abc123hash', '/sandbox/doc.pdf');
      INSERT INTO sections (id, document_id, title, sort_order)
      VALUES ('sec-1', 'doc-1', 'Chapter 1', 1);
    `);

    // Test INSERT Trigger
    db.exec(`
      INSERT INTO blocks (id, section_id, document_id, content, sort_order)
      VALUES ('block-1', 'sec-1', 'doc-1', 'This is a test block for FTS5 index syncing.', 1);
    `);

    // Verify it was inserted into FTS
    const ftsResult = db.prepare("SELECT * FROM blocks_fts WHERE block_id = 'block-1'").get();
    expect(ftsResult).toBeDefined();
    expect((ftsResult as any).content).toBe('This is a test block for FTS5 index syncing.');
  });
});