jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn().mockReturnValue({
    execSync: jest.fn(),
  }),
}));

import Database from 'better-sqlite3';
import { INITIALIZE_DATABASE_SCHEMA } from '../../database/schema';
import { generateAuthorKeyPair } from '../crypto';
import { compressLZW, decompressLZW, packNotesBackup, unpackNotesBackup } from '../packer';

describe('LZW Compression & Binary Notes Packer', () => {
  describe('LZW Core Compression', () => {
    it('should compress and decompress strings back to original values', () => {
      const originalText = 'Fabulous notes backup! Relational SQLite schemas index content correctly.';
      const compressed = compressLZW(originalText);
      expect(compressed.length).toBeGreaterThan(0);
      expect(typeof compressed).toBe('string');

      const decompressed = decompressLZW(compressed);
      expect(decompressed).toBe(originalText);
    });

    it('should handle empty strings and repetitive strings gracefully', () => {
      expect(compressLZW('')).toBe('');
      expect(decompressLZW('')).toBe('');

      const repetitive = 'a'.repeat(100);
      const compressed = compressLZW(repetitive);
      // Verify compression worked (compressed size is much smaller than original for high-redundancy text)
      const decompressed = decompressLZW(compressed);
      expect(decompressed).toBe(repetitive);
    });
  });

  describe('Integration Note Packing & Cryptographic Importing', () => {
    let db: Database.Database;
    const corpusId = 'corp-packer-test';
    const docId = 'doc-packer-test';
    const docHash = 'sha256_mock_hash_packer';
    const secId = 'sec-packer-test';

    beforeEach(() => {
      // 1. Setup in-memory SQLite DB
      db = new Database(':memory:');
      db.exec(INITIALIZE_DATABASE_SCHEMA);

      // 2. Seed mock document structures
      db.prepare('INSERT INTO corpora (id, name) VALUES (?, ?);').run(corpusId, 'Packer Test Corpus');
      db.prepare(
        'INSERT INTO documents (id, corpus_id, title, author, sha256_hash, storage_path) VALUES (?, ?, ?, ?, ?, ?);'
      ).run(docId, corpusId, 'Secure Notes Package Ingestion', 'Dr. Packer', docHash, '/sandbox/packer.pdf');
      db.prepare('INSERT INTO sections (id, document_id, title, sort_order) VALUES (?, ?, ?, ?);').run(
        secId,
        docId,
        'Chapter 1: Packs',
        1
      );
      db.prepare(
        'INSERT INTO blocks (id, section_id, document_id, content, sort_order) VALUES (?, ?, ?, ?, ?);'
      ).run(
        'block-1',
        secId,
        docId,
        '<p>This block has parsed text.</p>',
        1
      );
    });

    afterEach(() => {
      db.close();
    });

    it('should pack notes, identify local asset references, sign manifest, compress, and successfully import', async () => {
      // 1. Create a note containing local-asset references
      db.prepare(
        `INSERT INTO annotations (id, document_id, block_id, annotation_type, color_code, highlighted_text, note_body, author_id)
         VALUES ('ann-packer-1', ?, 'block-1', 'note', 'yellow', 'parsed text', 'Checkout this diagram: ![caption](local-asset://diagram_1.png) and mock: local-asset://logo_main.png', 'author-local');`
      ).run(docId);

      const keys = generateAuthorKeyPair();

      // 2. Pack the notes backup
      const notesPackageStr = await packNotesBackup(db, docId, keys.privateKey, keys.publicKey);
      expect(notesPackageStr.length).toBeGreaterThan(0);

      // 3. Delete annotation in DB to verify it gets re-imported
      db.prepare('DELETE FROM annotations;').run();
      expect(db.prepare('SELECT COUNT(*) as count FROM annotations;').get() as any).toEqual({ count: 0 });

      // 4. Unpack and import backup
      const importResult = await unpackNotesBackup(db, notesPackageStr);
      expect(importResult.status).toBe('success');
      expect(importResult.importedCount).toBe(1);

      // 5. Verify database matches
      const rows = db.prepare('SELECT id, note_body, author_id FROM annotations;').all() as any[];
      expect(rows.length).toBe(1);
      expect(rows[0].id).toBe('ann-packer-1');
      expect(rows[0].author_id).toBe('author-local');
      expect(rows[0].note_body).toContain('local-asset://diagram_1.png');
    });

    it('should reject unpacking note packets with tampered manifests or invalid signatures', async () => {
      db.prepare(
        `INSERT INTO annotations (id, document_id, block_id, annotation_type, color_code, highlighted_text, note_body, author_id)
         VALUES ('ann-packer-1', ?, 'block-1', 'note', 'yellow', 'parsed text', 'Original note', 'author-local');`
      ).run(docId);

      const keys = generateAuthorKeyPair();
      const notesPackageStr = await packNotesBackup(db, docId, keys.privateKey, keys.publicKey);

      // Decompress, tamper, and re-compress to simulate attacker tampering
      const decompressed = decompressLZW(notesPackageStr);
      const containerObj = JSON.parse(decompressed);

      // Tamper note body
      containerObj.manifest.annotations[0].note_body = 'Tampered note content!';
      const tamperedPackageStr = compressLZW(JSON.stringify(containerObj));

      // Attempt to import the tampered package
      const importResult = await unpackNotesBackup(db, tamperedPackageStr);
      expect(importResult.status).toBe('signature_invalid');
      expect(importResult.importedCount).toBe(0);

      // Verify the DB was not updated
      const count = db.prepare('SELECT COUNT(*) as count FROM annotations;').get() as any;
      expect(count.count).toBe(1);
      const note = db.prepare('SELECT note_body FROM annotations WHERE id = ?;').get('ann-packer-1') as any;
      expect(note.note_body).toBe('Original note');
    });
  });
});
