jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn().mockReturnValue({
    execSync: jest.fn(),
  }),
}));

import Database from 'better-sqlite3';
import { INITIALIZE_DATABASE_SCHEMA } from '../schema';
import { BLESyncCommunicator } from '../bleSync';
import WirelessSyncBridge, { bleChunkListeners } from '../../native/WirelessSyncBridge';

describe('Bluetooth LE Delta Sync Fallback communicator', () => {
  let dbSource: Database.Database;
  let dbTarget: Database.Database;

  const corpusId = 'corp-ble-test';
  const docId = 'doc-ble-test';
  const docHash = 'sha256_mock_hash_ble';
  const secId = 'sec-ble-test';

  beforeEach(() => {
    // 1. Initialize Source and Target in-memory databases with identical triggers
    dbSource = new Database(':memory:');
    dbSource.exec(INITIALIZE_DATABASE_SCHEMA);

    dbTarget = new Database(':memory:');
    dbTarget.exec(INITIALIZE_DATABASE_SCHEMA);

    // 2. Seed baseline structures in BOTH databases
    for (const db of [dbSource, dbTarget]) {
      db.prepare('INSERT INTO corpora (id, name) VALUES (?, ?);').run(corpusId, 'BLE Sync Test Corpus');
      db.prepare(
        'INSERT INTO documents (id, corpus_id, title, author, sha256_hash, storage_path) VALUES (?, ?, ?, ?, ?, ?);'
      ).run(docId, corpusId, 'Offline BLE Synchronizations', 'Dr. BLE', docHash, '/sandbox/ble.pdf');
      db.prepare('INSERT INTO sections (id, document_id, title, sort_order) VALUES (?, ?, ?, ?);').run(
        secId,
        docId,
        'Chapter 1: BLE',
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
    }
  });

  afterEach(() => {
    dbSource.close();
    dbTarget.close();
  });

  it('should compile deltas, chunk them into MTU blocks, verify checksums, reassemble, and apply successfully', async () => {
    // 1. Add annotations and tags on the source DB
    dbSource.prepare(
      `INSERT INTO annotations (id, document_id, block_id, annotation_type, color_code, highlighted_text, note_body, author_id, created_at, updated_at)
       VALUES ('ann-ble-1', ?, 'block-1', 'highlight', 'yellow', 'parsed text', 'Synced over BLE!', 'author-alpha', '2026-05-28T09:00:00Z', '2026-05-28T09:00:00Z');`
    ).run(docId);
    dbSource.prepare("INSERT INTO tags (id, name, source, created_at) VALUES ('tag-bluetooth', 'bluetooth', 'user', '2026-05-28T09:00:00Z');").run();
    dbSource.prepare("INSERT INTO block_tags (block_id, tag_id) VALUES ('block-1', 'tag-bluetooth');").run();

    const communicator = new BLESyncCommunicator();

    // 2. Compile and partition into 512-byte MTU packets
    const chunks = await communicator.sendDelta(dbSource, docId, '2026-05-28T08:00:00Z', 'device-tablet-alpha');
    expect(chunks.length).toBeGreaterThan(0);

    // Verify chunk structure
    const firstChunk = chunks[0];
    const parts = firstChunk.split('|');
    expect(parts.length).toBe(5);
    expect(parts[1]).toBe('0'); // first chunk index
    expect(parseInt(parts[2], 10)).toBe(chunks.length); // total chunks

    // 3. Receive chunks sequentially on target device
    let progress = 0;
    let completeDeltaJson: string | null = null;

    for (const chunk of chunks) {
      const res = communicator.receiveChunk(chunk);
      progress = res.progress;
      completeDeltaJson = res.completeDeltaJson;
    }

    expect(progress).toBe(100);
    expect(completeDeltaJson).not.toBeNull();

    // 4. Apply the reassembled delta to the target database
    const syncResult = communicator.applyReceivedDelta(dbTarget, completeDeltaJson!);
    expect(syncResult.status).toBe('success');
    expect(syncResult.appliedAnnotationsCount).toBe(1);
    expect(syncResult.appliedTagsCount).toBeGreaterThanOrEqual(0);

    // 5. Verify database matches
    const ann = dbTarget.prepare('SELECT note_body, author_id FROM annotations WHERE id = ?;').get('ann-ble-1') as any;
    expect(ann.note_body).toBe('Synced over BLE!');
    expect(ann.author_id).toBe('author-alpha');
  });

  it('should throw an error if chunk checksum verification fails', async () => {
    // Add annotation to compile delta
    dbSource.prepare(
      `INSERT INTO annotations (id, document_id, block_id, annotation_type, note_body, author_id)
       VALUES ('ann-ble-2', ?, 'block-1', 'note', 'Some body', 'author-alpha');`
    ).run(docId);

    const communicator = new BLESyncCommunicator();
    const chunks = await communicator.sendDelta(dbSource, docId, '2026-05-28T08:00:00Z', 'device-tablet-alpha');

    // Tamper the payload in the first chunk to break the checksum
    const parts = chunks[0].split('|');
    parts[4] = 'tampered_payload_data';
    const tamperedChunk = parts.join('|');

    expect(() => {
      communicator.receiveChunk(tamperedChunk);
    }).toThrow('Checksum verification failed');
  });

  it('should support physical transmission and receive callbacks via WirelessSyncBridge', async () => {
    // 1. Add annotations on the source DB
    dbSource.prepare(
      `INSERT INTO annotations (id, document_id, block_id, annotation_type, note_body, author_id, created_at, updated_at)
       VALUES ('ann-phys-1', ?, 'block-1', 'note', 'Physical Sync Test!', 'author-alpha', '2026-05-28T09:00:00Z', '2026-05-28T09:00:00Z');`
    ).run(docId);

    const communicator = new BLESyncCommunicator();

    // Mock sendBleChunk to intercept outbound packets
    const sentChunks: string[] = [];
    jest.spyOn(WirelessSyncBridge, 'sendBleChunk').mockImplementation(async (deviceId: any, chunk: any) => {
      sentChunks.push(chunk);
      return true;
    });

    // 2. Perform physical transmission
    const success = await communicator.sendDeltaPhysically(dbSource, docId, '2026-05-28T08:00:00Z', 'phys-peer');
    expect(success).toBe(true);
    expect(sentChunks.length).toBeGreaterThan(0);

    // 3. Setup physical listener on target device
    const onProgress = jest.fn();
    const onComplete = jest.fn();
    const onError = jest.fn();

    const listener = communicator.setupPhysicalListener(dbTarget, onProgress, onComplete, onError);

    // 4. Simulate peer transmitting those intercepted chunks back into our listener
    for (const chunk of sentChunks) {
      bleChunkListeners.forEach(listener => listener({ deviceId: 'phys-peer', chunk }));
    }

    expect(onProgress).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    // Verify database matches
    const ann = dbTarget.prepare('SELECT note_body FROM annotations WHERE id = ?;').get('ann-phys-1') as any;
    expect(ann.note_body).toBe('Physical Sync Test!');

    listener.remove();
  });
});

