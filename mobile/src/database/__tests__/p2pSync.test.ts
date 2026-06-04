jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn().mockReturnValue({
    execSync: jest.fn(),
  }),
}));

import Database from 'better-sqlite3';
import { INITIALIZE_DATABASE_SCHEMA } from '../schema';
import { compileSyncDelta, applySyncDelta, P2PSyncService, SyncDelta } from '../p2pSync';

describe('P2P Relational Sync Delta Protocol & LWW CRDT Merging', () => {
  let dbSource: Database.Database;
  let dbTarget: Database.Database;

  const corpusId = 'corp-sync-test';
  const docId = 'doc-sync-test';
  const docHash = 'sha256_mock_hash_sync';
  const secId = 'sec-sync-test';

  beforeEach(() => {
    // 1. Initialize Source and Target in-memory databases with identical triggers
    dbSource = new Database(':memory:');
    dbSource.exec(INITIALIZE_DATABASE_SCHEMA);

    dbTarget = new Database(':memory:');
    dbTarget.exec(INITIALIZE_DATABASE_SCHEMA);

    // 2. Seed baseline structures in BOTH databases
    for (const db of [dbSource, dbTarget]) {
      db.prepare('INSERT INTO corpora (id, name) VALUES (?, ?);').run(corpusId, 'P2P Test Corpus');
      db.prepare(
        'INSERT INTO documents (id, corpus_id, title, author, sha256_hash, storage_path) VALUES (?, ?, ?, ?, ?, ?);'
      ).run(docId, corpusId, 'Offline Synchronizations DDL', 'Dr. Sync Peer', docHash, '/sandbox/sync.pdf');
      db.prepare('INSERT INTO sections (id, document_id, title, sort_order) VALUES (?, ?, ?, ?);').run(
        secId,
        docId,
        'Chapter 1: Relational Deltas',
        1
      );
      db.prepare(
        'INSERT INTO blocks (id, section_id, document_id, content, sort_order) VALUES (?, ?, ?, ?, ?);'
      ).run(
        'block-1',
        secId,
        docId,
        '<p>Relational SQLite triggers automate FTS5 indexing.</p>',
        1
      );
    }
  });

  afterEach(() => {
    dbSource.close();
    dbTarget.close();
  });

  describe('Delta Query Compilation', () => {
    it('should compile annotations and tags created or modified since timestamp checkpoint', () => {
      // Seed some annotations in the source DB
      dbSource.prepare(
        `INSERT INTO annotations (id, document_id, block_id, annotation_type, color_code, highlighted_text, note_body, created_at, updated_at)
         VALUES ('ann-src-1', ?, 'block-1', 'highlight', 'yellow', 'SQLite triggers', 'Source Note', '2026-05-28T09:00:00Z', '2026-05-28T09:00:00Z');`
      ).run(docId);

      // Seed a tag mapping
      dbSource.prepare("INSERT INTO tags (id, name, source, created_at) VALUES ('tag-crdt', 'crdt', 'user', '2026-05-28T09:00:00Z');").run();
      dbSource.prepare("INSERT INTO block_tags (block_id, tag_id) VALUES ('block-1', 'tag-crdt');").run();

      // Compile delta since 2026-05-28T08:30:00Z -> should capture our seeded items
      const delta = compileSyncDelta(dbSource, docId, '2026-05-28T08:30:00Z', 'tablet-src');

      expect(delta.schema_version).toBe('1.0');
      expect(delta.device_id).toBe('tablet-src');
      expect(delta.document.sha256_hash).toBe(docHash);
      expect(delta.annotations.length).toBe(1);
      expect(delta.annotations[0].id).toBe('ann-src-1');
      expect(delta.annotations[0].tags).toContain('crdt');

      expect(delta.tags.length).toBe(1);
      expect(delta.tags[0].name).toBe('crdt');

      expect(delta.block_tags.length).toBe(1);
      expect(delta.block_tags[0].block_id).toBe('block-1');
    });
  });

  describe('CRDT Merging & Last-Write-Wins', () => {
    it('should overwrite older local records with newer incoming delta updates', () => {
      // Seed older annotation in target DB
      dbTarget.prepare(
        `INSERT INTO annotations (id, document_id, block_id, annotation_type, color_code, highlighted_text, note_body, created_at, updated_at)
         VALUES ('ann-lww-1', ?, 'block-1', 'highlight', 'blue', 'Relational', 'Old Target Note', '2026-05-28T05:00:00Z', '2026-05-28T05:00:00Z');`
      ).run(docId);

      // Construct a delta with a newer updated_at timestamp
      const incomingDelta: SyncDelta = {
        schema_version: '1.0',
        device_id: 'phone-incoming',
        timestamp: '2026-05-28T10:00:00Z',
        document: {
          title: 'Offline Synchronizations DDL',
          author: 'Dr. Sync Peer',
          source_type: 'pdf',
          sha256_hash: docHash,
        },
        annotations: [
          {
            id: 'ann-lww-1',
            annotation_type: 'highlight',
            color_code: 'purple',
            highlighted_text: 'Relational',
            note_body: 'Newer Overwritten Note',
            anchor_metadata: JSON.stringify({ prefix: '', suffix: '', offset: 0 }),
            created_at: '2026-05-28T05:00:00Z',
            updated_at: '2026-05-28T09:30:00Z', // 4.5 hours newer
            tags: [],
          },
        ],
        tags: [],
        block_tags: [],
      };

      const result = applySyncDelta(dbTarget, incomingDelta);
      expect(result.status).toBe('success');
      expect(result.appliedAnnotationsCount).toBe(1);
      expect(result.skippedAnnotationsCount).toBe(0);

      // Verify DB contains overwritten content
      const row = dbTarget.prepare('SELECT color_code, note_body FROM annotations WHERE id = ?;').get('ann-lww-1') as any;
      expect(row.color_code).toBe('purple');
      expect(row.note_body).toBe('Newer Overwritten Note');
    });

    it('should skip overwriting when incoming delta annotations are older than local records', () => {
      // Seed newer annotation in target DB
      dbTarget.prepare(
        `INSERT INTO annotations (id, document_id, block_id, annotation_type, color_code, highlighted_text, note_body, created_at, updated_at)
         VALUES ('ann-lww-1', ?, 'block-1', 'highlight', 'red', 'Relational', 'New Local Note', '2026-05-28T10:00:00Z', '2026-05-28T10:00:00Z');`
      ).run(docId);

      // Construct a delta with an older updated_at timestamp
      const incomingDelta: SyncDelta = {
        schema_version: '1.0',
        device_id: 'phone-incoming',
        timestamp: '2026-05-28T12:00:00Z',
        document: {
          title: 'Offline Synchronizations DDL',
          author: 'Dr. Sync Peer',
          source_type: 'pdf',
          sha256_hash: docHash,
        },
        annotations: [
          {
            id: 'ann-lww-1',
            annotation_type: 'highlight',
            color_code: 'green',
            highlighted_text: 'Relational',
            note_body: 'Older Skipped Note',
            anchor_metadata: JSON.stringify({ prefix: '', suffix: '', offset: 0 }),
            created_at: '2026-05-28T10:00:00Z',
            updated_at: '2026-05-28T09:00:00Z', // 1 hour older than local (10:00)
            tags: [],
          },
        ],
        tags: [],
        block_tags: [],
      };

      const result = applySyncDelta(dbTarget, incomingDelta);
      expect(result.status).toBe('success');
      expect(result.appliedAnnotationsCount).toBe(0);
      expect(result.skippedAnnotationsCount).toBe(1);

      // Verify DB retained the local red version
      const row = dbTarget.prepare('SELECT color_code FROM annotations WHERE id = ?;').get('ann-lww-1') as any;
      expect(row.color_code).toBe('red');
    });

    it('should support social reading co-existence where different UUIDs highlight the same text span', () => {
      const incomingDelta: SyncDelta = {
        schema_version: '1.0',
        device_id: 'phone-incoming',
        timestamp: '2026-05-28T10:00:00Z',
        document: {
          title: 'Offline Synchronizations DDL',
          author: 'Dr. Sync Peer',
          source_type: 'pdf',
          sha256_hash: docHash,
        },
        annotations: [
          {
            id: 'uuid-author-alpha',
            annotation_type: 'highlight',
            color_code: 'yellow',
            highlighted_text: 'SQLite triggers',
            note_body: 'Alpha Note',
            anchor_metadata: JSON.stringify({ prefix: '', suffix: '', offset: 0 }),
            created_at: '2026-05-28T08:00:00Z',
            updated_at: '2026-05-28T08:00:00Z',
            tags: [],
          },
          {
            id: 'uuid-author-beta',
            annotation_type: 'highlight',
            color_code: 'blue',
            highlighted_text: 'SQLite triggers',
            note_body: 'Beta Note',
            anchor_metadata: JSON.stringify({ prefix: '', suffix: '', offset: 0 }),
            created_at: '2026-05-28T08:30:00Z',
            updated_at: '2026-05-28T08:30:00Z',
            tags: [],
          },
        ],
        tags: [],
        block_tags: [],
      };

      const result = applySyncDelta(dbTarget, incomingDelta);
      expect(result.status).toBe('success');
      expect(result.appliedAnnotationsCount).toBe(2);

      const rowsCount = dbTarget.prepare("SELECT COUNT(*) as count FROM annotations WHERE highlighted_text = 'SQLite triggers';").get() as any;
      expect(rowsCount.count).toBe(2); // Co-exist cleanly!
    });
  });

  describe('Fuzzy Re-Anchoring Edition Fallback', () => {
    it('should fuzzy re-anchor notes when SHA-256 differs but title/author metadata match (edition mismatch)', () => {
      // 1. Create a different document (edition mismatch) in another corpus on dbTarget
      const diffDocId = 'doc-edition-mismatch';
      const diffDocHash = 'sha256_different_edition_crdt';
      dbTarget.prepare(
        'INSERT INTO documents (id, corpus_id, title, author, sha256_hash, storage_path) VALUES (?, ?, ?, ?, ?, ?);'
      ).run(diffDocId, corpusId, 'Offline Synchronizations DDL', 'Dr. Sync Peer', diffDocHash, '/sandbox/diff.pdf');
      
      const diffSecId = 'sec-edition-mismatch';
      dbTarget.prepare('INSERT INTO sections (id, document_id, title, sort_order) VALUES (?, ?, ?, ?);').run(
        diffSecId,
        diffDocId,
        'Chapter 1: Relational Deltas',
        1
      );

      // Slightly altered content to verify fuzzy anchoring alignment:
      // "Relational SQLite trigger automates FTS5 indexing" instead of "Relational SQLite triggers automate FTS5 indexing"
      dbTarget.prepare(
        'INSERT INTO blocks (id, section_id, document_id, content, sort_order) VALUES (?, ?, ?, ?, ?);'
      ).run(
        'block-diff-1',
        diffSecId,
        diffDocId,
        '<p>Relational SQLite trigger automates FTS5 indexing.</p>',
        1
      );

      // Delete the original document in dbTarget to force metadata-only search matching fallback
      dbTarget.prepare('DELETE FROM documents WHERE id = ?;').run(docId);

      // 2. Import an annotation mapped to the original document signature
      const incomingDelta: SyncDelta = {
        schema_version: '1.0',
        device_id: 'tablet-original',
        timestamp: '2026-05-28T09:00:00Z',
        document: {
          title: 'Offline Synchronizations DDL',
          author: 'Dr. Sync Peer',
          source_type: 'pdf',
          sha256_hash: docHash, // Original signature
        },
        annotations: [
          {
            id: 'ann-fuzzy-sync-1',
            annotation_type: 'highlight',
            color_code: 'yellow',
            highlighted_text: 'SQLite trigger',
            note_body: 'Sync fuzzy reanchor check',
            anchor_metadata: JSON.stringify({ prefix: 'Relational ', suffix: ' automates FTS5', offset: 11 }),
            created_at: '2026-05-28T08:00:00Z',
            updated_at: '2026-05-28T08:00:00Z',
            tags: [],
          },
        ],
        tags: [],
        block_tags: [],
      };

      const result = applySyncDelta(dbTarget, incomingDelta);
      expect(result.status).toBe('success');
      expect(result.appliedAnnotationsCount).toBe(1);
      expect(result.fuzzyReAnchorCount).toBe(1);

      const ann = dbTarget.prepare('SELECT block_id, anchor_metadata FROM annotations WHERE id = ?;').get('ann-fuzzy-sync-1') as any;
      expect(ann.block_id).toBe('block-diff-1'); // Fuzzy reanchored to the second edition block!
    });
  });

  describe('P2PSyncService Network Discovery Simulation', () => {
    it('should complete peer discovery, handshake, and mock sync exchange successfully', async () => {
      // Seed target annotation in source db so compiling delta has data
      dbSource.prepare(
        `INSERT INTO annotations (id, document_id, block_id, annotation_type, color_code, highlighted_text, note_body, created_at, updated_at)
         VALUES ('ann-p2p-crdt-1', ?, 'block-1', 'highlight', 'yellow', 'SQLite triggers', 'Source text', '2026-05-28T09:00:00Z', '2026-05-28T09:00:00Z');`
      ).run(docId);

      const service = new P2PSyncService('tablet-1');

      let peerFoundId = '';
      await service.startDiscovery('tablet-1', (id) => {
        peerFoundId = id;
      });

      expect(peerFoundId).toBe('phone-1');

      const connected = await service.connectToPeer(peerFoundId);
      expect(connected).toBe(true);

      const syncResult = await service.handshakeAndSync(dbSource, docId, '2026-05-28T08:00:00Z');

      expect(syncResult.sentDelta.annotations.length).toBe(1);
      expect(syncResult.receivedDelta.annotations.length).toBe(1);
      expect(syncResult.appliedResult.status).toBe('success');
    });
  });
});
