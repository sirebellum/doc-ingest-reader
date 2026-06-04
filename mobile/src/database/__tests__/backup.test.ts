jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn().mockReturnValue({
    execSync: jest.fn(),
  }),
}));

import Database from 'better-sqlite3';
import { INITIALIZE_DATABASE_SCHEMA } from '../schema';
import { exportDocumentNotesBackup, importDocumentNotesBackup, BackupPayload } from '../backup';

describe('Relational JSON Backups & Sync Conflict Resolution', () => {
  let db: Database.Database;
  const corpusId = 'corp-backup-test';
  const docId = 'doc-backup-test';
  const docHash = 'sha256_mock_hash_123';
  const secId = 'sec-backup-test';

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(INITIALIZE_DATABASE_SCHEMA);

    // Seed database relational structure
    db.prepare('INSERT INTO corpora (id, name) VALUES (?, ?);').run(corpusId, 'Computer Science Research');
    db.prepare(
      'INSERT INTO documents (id, corpus_id, title, author, sha256_hash, storage_path) VALUES (?, ?, ?, ?, ?, ?);'
    ).run(docId, corpusId, 'SQLite Ingestion Architecture', 'Dr. Jane Dev', docHash, '/sandbox/sqlite.pdf');
    db.prepare('INSERT INTO sections (id, document_id, title, sort_order) VALUES (?, ?, ?, ?);').run(
      secId,
      docId,
      'Chapter 1: Relational Triggers',
      1
    );

    // Insert content blocks
    db.prepare(
      'INSERT INTO blocks (id, section_id, document_id, content, sort_order) VALUES (?, ?, ?, ?, ?);'
    ).run(
      'block-1',
      secId,
      docId,
      '<p>SQLite triggers automate the synchronizations of full-text search index virtual tables safely.</p>',
      1
    );
    db.prepare(
      'INSERT INTO blocks (id, section_id, document_id, content, sort_order) VALUES (?, ?, ?, ?, ?);'
    ).run(
      'block-2',
      secId,
      docId,
      '<p>Social reading empowers multiple collaborative annotation layers on continuous blocks.</p>',
      2
    );
  });

  afterEach(() => {
    db.close();
  });

  describe('JSON Export Subsystem', () => {
    it('should compile document metadata, annotations, and tag records without raw source text', () => {
      // Seed an annotation with a tag
      db.prepare(
        `INSERT INTO annotations (id, document_id, block_id, annotation_type, color_code, highlighted_text, note_body, anchor_metadata, created_at, updated_at)
         VALUES (?, ?, ?, 'highlight', 'hsl(48, 100%, 65%)', 'full-text search index', 'Important mechanism', ?, '2026-05-28T08:00:00Z', '2026-05-28T08:00:00Z');`
      ).run('ann-1', docId, 'block-1', JSON.stringify({ prefix: 'synchronizations of ', suffix: ' virtual tables', offset: 45 }));

      db.prepare("INSERT INTO tags (id, name, source) VALUES ('tag-fts', 'fts', 'user');").run();
      db.prepare("INSERT INTO block_tags (block_id, tag_id) VALUES ('block-1', 'tag-fts');").run();

      const payload = exportDocumentNotesBackup(db, docId);

      expect(payload.schema_version).toBe('1.0');
      expect(payload.document.title).toBe('SQLite Ingestion Architecture');
      expect(payload.document.sha256_hash).toBe(docHash);
      expect(payload.annotations.length).toBe(1);

      const ann = payload.annotations[0];
      expect(ann.id).toBe('ann-1');
      expect(ann.highlighted_text).toBe('full-text search index');
      expect(ann.note_body).toBe('Important mechanism');
      expect(ann.tags).toContain('fts');

      // Verify that no raw document source text from blocks is present in the payload (preserving copyright)
      const payloadString = JSON.stringify(payload);
      expect(payloadString).not.toContain('SQLite triggers automate the synchronizations');
    });
  });

  describe('JSON Import Subsystem & Conflict Resolution', () => {
    it('should return document_not_found if document signature and metadata fallbacks fail', () => {
      const payload: BackupPayload = {
        schema_version: '1.0',
        document: {
          title: 'Unknown Title',
          author: 'Unknown Author',
          source_type: 'pdf',
          sha256_hash: 'nonexistent_sha256',
          metadata: null,
        },
        annotations: [],
      };

      const result = importDocumentNotesBackup(db, payload);
      expect(result.status).toBe('document_not_found');
      expect(result.docTitle).toBe('Unknown Title');
      expect(result.sha256).toBe('nonexistent_sha256');
    });

    it('should upsert matching UUIDs based on the newest updated_at modification timestamp', () => {
      // 1. Seed existing annotation inside target db
      db.prepare(
        `INSERT INTO annotations (id, document_id, block_id, annotation_type, color_code, highlighted_text, note_body, created_at, updated_at)
         VALUES ('ann-matching-1', ?, 'block-1', 'highlight', 'blue', 'SQLite triggers', 'Old Note', '2026-05-28T00:00:00Z', '2026-05-28T00:00:00Z');`
      ).run(docId);

      // 2. Import same ID with a newer timestamp -> should OVERWRITE
      const payloadNewer: BackupPayload = {
        schema_version: '1.0',
        document: {
          title: 'SQLite Ingestion Architecture',
          author: 'Dr. Jane Dev',
          source_type: 'pdf',
          sha256_hash: docHash,
          metadata: null,
        },
        annotations: [
          {
            id: 'ann-matching-1',
            annotation_type: 'highlight',
            color_code: 'red',
            highlighted_text: 'SQLite triggers',
            note_body: 'Newer Note Body',
            anchor_metadata: JSON.stringify({ prefix: '', suffix: '', offset: 0 }),
            created_at: '2026-05-28T00:00:00Z',
            updated_at: '2026-05-28T12:00:00Z',
            tags: [],
          },
        ],
      };

      const resultNewer = importDocumentNotesBackup(db, payloadNewer);
      expect(resultNewer.status).toBe('success');
      expect(resultNewer.importedCount).toBe(1);
      expect(resultNewer.skippedCount).toBe(0);

      const rowNewer = db.prepare('SELECT color_code, note_body FROM annotations WHERE id = ?;').get('ann-matching-1') as any;
      expect(rowNewer.color_code).toBe('red');
      expect(rowNewer.note_body).toBe('Newer Note Body');

      // 3. Import same ID with an older timestamp -> should SKIP
      const payloadOlder: BackupPayload = {
        schema_version: '1.0',
        document: {
          title: 'SQLite Ingestion Architecture',
          author: 'Dr. Jane Dev',
          source_type: 'pdf',
          sha256_hash: docHash,
          metadata: null,
        },
        annotations: [
          {
            id: 'ann-matching-1',
            annotation_type: 'highlight',
            color_code: 'green',
            highlighted_text: 'SQLite triggers',
            note_body: 'Older skipped note',
            anchor_metadata: JSON.stringify({ prefix: '', suffix: '', offset: 0 }),
            created_at: '2026-05-28T00:00:00Z',
            updated_at: '2026-05-28T06:00:00Z', // Older than existing database timestamp 12:00:00Z
            tags: [],
          },
        ],
      };

      const resultOlder = importDocumentNotesBackup(db, payloadOlder);
      expect(resultOlder.status).toBe('success');
      expect(resultOlder.importedCount).toBe(0);
      expect(resultOlder.skippedCount).toBe(1);

      const rowOlder = db.prepare('SELECT color_code, note_body FROM annotations WHERE id = ?;').get('ann-matching-1') as any;
      expect(rowOlder.color_code).toBe('red'); // Maintained older red version
    });

    it('should support social reading co-existence when different UUIDs highlight the same text span', () => {
      const payload: BackupPayload = {
        schema_version: '1.0',
        document: {
          title: 'SQLite Ingestion Architecture',
          author: 'Dr. Jane Dev',
          source_type: 'pdf',
          sha256_hash: docHash,
          metadata: null,
        },
        annotations: [
          {
            id: 'uuid-author-a',
            annotation_type: 'highlight',
            color_code: 'yellow',
            highlighted_text: 'Social reading',
            note_body: 'Author A Note',
            anchor_metadata: JSON.stringify({ prefix: '', suffix: '', offset: 0 }),
            created_at: '2026-05-28T08:00:00Z',
            updated_at: '2026-05-28T08:00:00Z',
            tags: [],
          },
          {
            id: 'uuid-author-b',
            annotation_type: 'highlight',
            color_code: 'blue',
            highlighted_text: 'Social reading',
            note_body: 'Author B Note',
            anchor_metadata: JSON.stringify({ prefix: '', suffix: '', offset: 0 }),
            created_at: '2026-05-28T09:00:00Z',
            updated_at: '2026-05-28T09:00:00Z',
            tags: [],
          },
        ],
      };

      const result = importDocumentNotesBackup(db, payload);
      expect(result.status).toBe('success');
      expect(result.importedCount).toBe(2);

      const countRow = db.prepare("SELECT COUNT(*) as count FROM annotations WHERE highlighted_text = 'Social reading';").get() as any;
      expect(countRow.count).toBe(2); // Co-exist cleanly!
    });

    it('should fuzzy re-anchor annotations via FTS5 if imported on mismatched document signature (metadata match)', () => {
      // 1. Create a different document in another corpus with same title/author but different SHA-256 (different edition)
      const diffDocId = 'doc-diff-edition';
      db.prepare(
        'INSERT INTO documents (id, corpus_id, title, author, sha256_hash, storage_path) VALUES (?, ?, ?, ?, ?, ?);'
      ).run(diffDocId, corpusId, 'SQLite Ingestion Architecture', 'Dr. Jane Dev', 'sha256_different_edition_456', '/sandbox/diff.pdf');
      
      const diffSecId = 'sec-diff-edition';
      db.prepare('INSERT INTO sections (id, document_id, title, sort_order) VALUES (?, ?, ?, ?);').run(
        diffSecId,
        diffDocId,
        'Chapter 1: Relational Triggers',
        1
      );

      // Seed slightly altered text (e.g. edition mismatch): "synchronization" instead of "synchronizations"
      db.prepare(
        'INSERT INTO blocks (id, section_id, document_id, content, sort_order) VALUES (?, ?, ?, ?, ?);'
      ).run(
        'block-diff-1',
        diffSecId,
        diffDocId,
        '<p>SQLite triggers automate the synchronization of full-text search index virtual tables safely.</p>',
        1
      );

      // 2. Import an annotation exported from the first document (sha256_mock_hash_123)
      const payload: BackupPayload = {
        schema_version: '1.0',
        document: {
          title: 'SQLite Ingestion Architecture',
          author: 'Dr. Jane Dev',
          source_type: 'pdf',
          sha256_hash: 'sha256_mock_hash_123', // Matches first document hash, but we will pretend to import it into a db containing ONLY the second edition
        },
        annotations: [
          {
            id: 'ann-fuzzy-1',
            annotation_type: 'highlight',
            color_code: 'hsl(48, 100%, 65%)',
            highlighted_text: 'full-text search index',
            note_body: 'Fuzzy anchor note',
            anchor_metadata: JSON.stringify({ prefix: 'synchronization of ', suffix: ' virtual tables', offset: 45 }),
            created_at: '2026-05-28T08:00:00Z',
            updated_at: '2026-05-28T08:00:00Z',
            tags: [],
          },
        ],
      };

      // Let's delete the first document so the importer is forced to fallback to the second edition (metadata match)
      db.prepare('DELETE FROM documents WHERE id = ?;').run(docId);

      const result = importDocumentNotesBackup(db, payload);
      expect(result.status).toBe('success');
      expect(result.importedCount).toBe(1);
      expect(result.fuzzyReAnchorCount).toBe(1);

      const importedAnn = db.prepare('SELECT block_id, anchor_metadata FROM annotations WHERE id = ?;').get('ann-fuzzy-1') as any;
      expect(importedAnn.block_id).toBe('block-diff-1'); // Fuzzy re-anchored successfully!
    });

    it('should set block_id to NULL (Orphan Notes) if no high-confidence block match can be found', () => {
      const payload: BackupPayload = {
        schema_version: '1.0',
        document: {
          title: 'SQLite Ingestion Architecture',
          author: 'Dr. Jane Dev',
          source_type: 'pdf',
          sha256_hash: docHash,
        },
        annotations: [
          {
            id: 'ann-orphan-1',
            annotation_type: 'highlight',
            color_code: 'yellow',
            highlighted_text: 'completely matching garbage text that does not exist in blocks',
            note_body: 'Orphaned note',
            anchor_metadata: JSON.stringify({ prefix: 'no prefix', suffix: 'no suffix', offset: 9999 }),
            created_at: '2026-05-28T08:00:00Z',
            updated_at: '2026-05-28T08:00:00Z',
            tags: [],
          },
        ],
      };

      const result = importDocumentNotesBackup(db, payload);
      expect(result.status).toBe('success');
      expect(result.importedCount).toBe(1);
      expect(result.orphanedCount).toBe(1);

      const importedAnn = db.prepare('SELECT block_id FROM annotations WHERE id = ?;').get('ann-orphan-1') as any;
      expect(importedAnn.block_id).toBeNull(); // Orphaned Note!
    });

    it('should verify cryptographically signed note packets, failing on tampered content', () => {
      const { generateAuthorKeyPair } = require('../../utils/crypto');
      const { publicKey, privateKey } = generateAuthorKeyPair();

      // Seed annotation to sign
      db.prepare(
        `INSERT INTO annotations (id, document_id, block_id, annotation_type, color_code, highlighted_text, note_body, created_at, updated_at)
         VALUES ('ann-signed-1', ?, 'block-1', 'highlight', 'yellow', 'SQLite triggers', 'Signed Content', '2026-05-28T08:00:00Z', '2026-05-28T08:00:00Z');`
      ).run(docId);

      const signedPayload = exportDocumentNotesBackup(db, docId, privateKey, publicKey);
      expect(signedPayload.signature).toBeDefined();
      expect(signedPayload.publicKey).toBe(publicKey);

      // Clear annotations to test import
      db.prepare('DELETE FROM annotations;').run();

      // Import the signed backup -> should succeed
      const successResult = importDocumentNotesBackup(db, signedPayload);
      expect(successResult.status).toBe('success');
      expect(successResult.importedCount).toBe(1);

      // Tamper with the payload (e.g. modify highlighted text) and import again -> should fail
      signedPayload.annotations[0].highlighted_text = 'SQLite triggers - altered';
      const failResult = importDocumentNotesBackup(db, signedPayload);
      expect(failResult.status).toBe('signature_invalid');
      expect(failResult.importedCount).toBe(0);
    });
  });
});
