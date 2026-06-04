import { getDatabaseAdapter, BackupPayload, ExportedAnnotation, ExportedDocument } from './backup';
import { fuzzyReAnchor, AnchorMetadata, SearchableBlock } from '../utils/anchoring';
import { mergeThreeWay, computeLCS } from '../utils/merging';

export interface SyncDelta {
  schema_version: string;
  device_id: string;
  timestamp: string;
  document: ExportedDocument;
  annotations: ExportedAnnotation[];
  tags: Array<{ id: string; name: string; source: string; created_at: string }>;
  block_tags: Array<{ block_id: string; tag_id: string }>;
}

export interface SyncResult {
  status: 'success' | 'document_not_found';
  appliedAnnotationsCount: number;
  skippedAnnotationsCount: number;
  fuzzyReAnchorCount: number;
  orphanedCount: number;
  appliedTagsCount: number;
  appliedBlockTagsCount: number;
}

/**
 * Compiles a database difference delta payload since the last common synchronization checkpoint.
 */
export function compileSyncDelta(
  dbInstance: any,
  documentId: string,
  sinceTimestamp: string,
  deviceId: string = 'device-default'
): SyncDelta {
  const db = getDatabaseAdapter(dbInstance);

  // 1. Fetch document metadata
  const doc = db.get<any>(
    'SELECT title, author, source_type, sha256_hash, metadata FROM documents WHERE id = ?;',
    [documentId]
  );
  if (!doc) {
    throw new Error(`Document with ID ${documentId} not found.`);
  }

  // 2. Fetch annotations created or updated since checkpoint
  const annotations = db.all<any>(
    `SELECT id, block_id, annotation_type, color_code, highlighted_text, note_body, anchor_metadata, author_id, created_at, updated_at 
     FROM annotations 
     WHERE document_id = ? AND updated_at >= ?;`,
    [documentId, sinceTimestamp]
  );

  const exportedAnnotations: ExportedAnnotation[] = annotations.map((ann) => {
    let tags: string[] = [];
    if (ann.block_id) {
      const tagRows = db.all<{ name: string }>(
        `SELECT t.name FROM tags t
         JOIN block_tags bt ON t.id = bt.tag_id
         WHERE bt.block_id = ?;`,
        [ann.block_id]
      );
      tags = tagRows.map((r) => r.name);
    }

    return {
      id: ann.id,
      annotation_type: ann.annotation_type,
      color_code: ann.color_code || 'hsl(48, 100%, 65%)',
      highlighted_text: ann.highlighted_text,
      note_body: ann.note_body,
      anchor_metadata: ann.anchor_metadata,
      author_id: ann.author_id,
      created_at: ann.created_at,
      updated_at: ann.updated_at,
      tags,
    };
  });

  // 3. Fetch tags created since checkpoint
  const tags = db.all<any>(
    'SELECT id, name, source, created_at FROM tags WHERE created_at >= ?;',
    [sinceTimestamp]
  );

  // 4. Fetch block tag associations for blocks in this document
  const blockTags = db.all<any>(
    `SELECT bt.block_id, bt.tag_id 
     FROM block_tags bt
     JOIN blocks b ON bt.block_id = b.id
     WHERE b.document_id = ?;`,
    [documentId]
  );

  return {
    schema_version: '1.0',
    device_id: deviceId,
    timestamp: new Date().toISOString(),
    document: {
      title: doc.title,
      author: doc.author,
      source_type: doc.source_type,
      sha256_hash: doc.sha256_hash,
      metadata: doc.metadata,
    },
    annotations: exportedAnnotations,
    tags,
    block_tags: blockTags,
  };
}

/**
 * Applies a relational sync delta, executing LWW conflict resolution and tag merging.
 */
export function applySyncDelta(dbInstance: any, delta: SyncDelta): SyncResult {
  const db = getDatabaseAdapter(dbInstance);
  const { document, annotations, tags, block_tags } = delta;

  // 1. Locate target document by SHA-256
  let targetDoc = db.get<any>('SELECT * FROM documents WHERE sha256_hash = ?;', [document.sha256_hash]);
  let fuzzyReAnchorNeeded = false;

  // Metadata Fallback Reader: search by title/author if hash differs (edition mismatch)
  if (!targetDoc) {
    targetDoc = db.get<any>(
      'SELECT * FROM documents WHERE title = ? AND (author = ? OR (author IS NULL AND ? IS NULL));',
      [document.title, document.author, document.author]
    );
    if (targetDoc) {
      fuzzyReAnchorNeeded = true;
    }
  }

  if (!targetDoc) {
    return {
      status: 'document_not_found',
      appliedAnnotationsCount: 0,
      skippedAnnotationsCount: 0,
      fuzzyReAnchorCount: 0,
      orphanedCount: 0,
      appliedTagsCount: 0,
      appliedBlockTagsCount: 0,
    };
  }

  const documentId = targetDoc.id;
  let appliedAnnotationsCount = 0;
  let skippedAnnotationsCount = 0;
  let fuzzyReAnchorCount = 0;
  let orphanedCount = 0;
  let appliedTagsCount = 0;
  let appliedBlockTagsCount = 0;

  // Cache blocks for fuzzy re-anchoring fallback searches
  let cachedBlocks: SearchableBlock[] | null = null;
  const getDocBlocks = (): SearchableBlock[] => {
    if (!cachedBlocks) {
      const rows = db.all<any>(
        'SELECT b.id, fts.content as text FROM blocks b JOIN blocks_fts fts ON b.id = fts.block_id WHERE b.document_id = ?;',
        [documentId]
      );
      cachedBlocks = rows.map((r) => ({ id: r.id, text: r.text }));
    }
    return cachedBlocks;
  };

  db.transaction(() => {
    // 2. Sync Annotations with Last-Write-Wins (LWW) CRDT Conflict Resolution
    for (const ann of annotations) {
      let finalNoteBody = ann.note_body;
      const existing = db.get<any>('SELECT id, note_body, author_id, updated_at FROM annotations WHERE id = ?;', [ann.id]);
      if (existing) {
        const incomingAuthor = ann.author_id || delta.device_id;
        const existingAuthor = existing.author_id;
        if (incomingAuthor && existingAuthor && incomingAuthor !== existingAuthor && ann.note_body !== existing.note_body) {
          // Perform Myers 3-way merge using LCS as base
          const baseText = computeLCS(existing.note_body || '', ann.note_body || '');
          const mergeRes = mergeThreeWay(baseText, existing.note_body || '', ann.note_body || '');
          finalNoteBody = mergeRes.mergedText;
        } else {
          // LWW: retains/overwrites only if incoming updated_at timestamp is strictly newer
          const incomingTime = new Date(ann.updated_at).getTime();
          const existingTime = new Date(existing.updated_at).getTime();
          if (incomingTime <= existingTime) {
            skippedAnnotationsCount++;
            continue;
          }
        }
      }

      // Resolve the anchor block in the target database
      let resolvedBlockId: string | null = null;
      let finalAnchorMetadata = ann.anchor_metadata;

      if (ann.highlighted_text) {
        let foundBlock = false;
        let anchorMeta: AnchorMetadata = { prefix: '', suffix: '', offset: 0 };
        if (ann.anchor_metadata) {
          try {
            anchorMeta = JSON.parse(ann.anchor_metadata);
          } catch {}
        }

        if (!fuzzyReAnchorNeeded) {
          // Attempt exact matching using FTS5 virtual table
          const ftsEscaped = ann.highlighted_text.replace(/[^\w\s]/g, ' ').trim();
          if (ftsEscaped) {
            const ftsMatch = db.get<any>(
              `SELECT b.id, fts.content as text FROM blocks b 
               JOIN blocks_fts fts ON b.id = fts.block_id 
               WHERE b.document_id = ? AND fts.content MATCH ? LIMIT 1;`,
              [documentId, `"${ftsEscaped}"`]
            );
            if (ftsMatch) {
              const idx = ftsMatch.text.indexOf(ann.highlighted_text);
              if (idx !== -1) {
                resolvedBlockId = ftsMatch.id;
                anchorMeta.offset = idx;
                finalAnchorMetadata = JSON.stringify(anchorMeta);
                foundBlock = true;
              }
            }
          }
        }

        // Fuzzy Re-anchoring Engine
        if (!foundBlock) {
          let candidateBlocks: SearchableBlock[] = [];
          const ftsEscaped = ann.highlighted_text.replace(/[^\w\s]/g, ' ').trim();
          if (ftsEscaped) {
            const candidateRows = db.all<any>(
              `SELECT b.id, fts.content as text FROM blocks b 
               JOIN blocks_fts fts ON b.id = fts.block_id 
               WHERE b.document_id = ? AND fts.content MATCH ? LIMIT 5;`,
              [documentId, ftsEscaped]
            );
            candidateBlocks = candidateRows.map((r) => ({ id: r.id, text: r.text }));
          }

          if (candidateBlocks.length === 0) {
            candidateBlocks = getDocBlocks();
          }

          const reAnchorResult = fuzzyReAnchor(ann.highlighted_text, anchorMeta, candidateBlocks);
          if (reAnchorResult && reAnchorResult.confidence >= 0.4) {
            resolvedBlockId = reAnchorResult.blockId;
            anchorMeta.offset = reAnchorResult.startOffset;
            finalAnchorMetadata = JSON.stringify(anchorMeta);
            fuzzyReAnchorCount++;
          } else {
            resolvedBlockId = null; // Store inside the Orphan Notes panel
            orphanedCount++;
          }
        }
      } else {
        resolvedBlockId = null;
        orphanedCount++;
      }

      // Write or Overwrite annotation record
      db.run(
        `INSERT OR REPLACE INTO annotations (id, document_id, block_id, annotation_type, color_code, highlighted_text, note_body, anchor_metadata, author_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          ann.id,
          documentId,
          resolvedBlockId,
          ann.annotation_type,
          ann.color_code,
          ann.highlighted_text,
          finalNoteBody,
          finalAnchorMetadata,
          ann.author_id || delta.device_id || 'peer',
          ann.created_at,
          ann.updated_at,
        ]
      );

      // Manage imported tags attached directly to annotation
      if (ann.tags && ann.tags.length > 0 && resolvedBlockId) {
        for (const tagName of ann.tags) {
          const cleanTag = tagName.toLowerCase().trim();
          if (cleanTag) {
            const tagId = `tag-${cleanTag}`;
            db.run('INSERT OR IGNORE INTO tags (id, name, source) VALUES (?, ?, ?);', [tagId, cleanTag, 'user']);
            db.run('INSERT OR IGNORE INTO block_tags (block_id, tag_id) VALUES (?, ?);', [resolvedBlockId, tagId]);
          }
        }
      }

      appliedAnnotationsCount++;
    }

    // 3. Merge Tags created since checkpoint
    for (const tag of tags) {
      const existing = db.get<any>('SELECT id FROM tags WHERE id = ?;', [tag.id]);
      if (!existing) {
        db.run(
          'INSERT OR IGNORE INTO tags (id, name, source, created_at) VALUES (?, ?, ?, ?);',
          [tag.id, tag.name.toLowerCase().trim(), tag.source, tag.created_at]
        );
        appliedTagsCount++;
      }
    }

    // 4. Merge Block Tags junction table relations
    for (const bt of block_tags) {
      // Confirm the block actually exists in the database before mapping the junction
      const blockExists = db.get<any>('SELECT id FROM blocks WHERE id = ?;', [bt.block_id]);
      if (blockExists) {
        db.run(
          'INSERT OR IGNORE INTO block_tags (block_id, tag_id) VALUES (?, ?);',
          [bt.block_id, bt.tag_id]
        );
        appliedBlockTagsCount++;
      }
    }
  });

  return {
    status: 'success',
    appliedAnnotationsCount,
    skippedAnnotationsCount,
    fuzzyReAnchorCount,
    orphanedCount,
    appliedTagsCount,
    appliedBlockTagsCount,
  };
}

/**
 * P2P Wi-Fi Local Discovery & Synchronization Handler Service.
 * Simulates network communication layers between offline-first tablets and smartphone peers.
 */
export class P2PSyncService {
  private deviceId: string;
  private discoveredPeers: Set<string>;
  private activePeerConnection: string | null;

  constructor(deviceId: string) {
    this.deviceId = deviceId;
    this.discoveredPeers = new Set();
    this.activePeerConnection = null;
  }

  async startDiscovery(
    deviceId: string,
    onDeviceFound: (peerId: string) => void
  ): Promise<void> {
    console.log(`[P2P Service] Device ${deviceId} initialized MDNS/DNS-SD discovery handshakes.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    // Simulate finding a peer device (e.g. tablet discovering smartphone)
    const mockPeer = this.deviceId === 'tablet-1' ? 'phone-1' : 'tablet-1';
    this.discoveredPeers.add(mockPeer);
    onDeviceFound(mockPeer);
  }

  async connectToPeer(peerId: string): Promise<boolean> {
    console.log(`[P2P Service] Initiating WebSocket handshake from ${this.deviceId} to peer ${peerId}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.activePeerConnection = peerId;
    return true;
  }

  async handshakeAndSync(
    dbInstance: any,
    documentId: string,
    lastSyncTimestamp: string
  ): Promise<{ sentDelta: SyncDelta; receivedDelta: SyncDelta; appliedResult: SyncResult }> {
    if (!this.activePeerConnection) {
      throw new Error('No active peer connection. Call connectToPeer first.');
    }

    // 1. Compile state differences on our device since checkpoint
    const sentDelta = compileSyncDelta(dbInstance, documentId, lastSyncTimestamp, this.deviceId);

    // 2. Simulate compiling and receiving peer delta packet
    // For test simulation, let's mirror or return a simulated peer packet containing new edits
    const receivedDelta: SyncDelta = {
      schema_version: '1.0',
      device_id: this.activePeerConnection,
      timestamp: new Date().toISOString(),
      document: sentDelta.document,
      annotations: sentDelta.annotations.map(ann => ({
        ...ann,
        id: `${ann.id}-peer-crdt`, // Unique peer annotation ID co-existing span
        updated_at: new Date(new Date(ann.updated_at).getTime() + 10000).toISOString(), // 10s newer edits (LWW wins)
      })),
      tags: sentDelta.tags.map(t => ({ ...t, id: `${t.id}-peer` })),
      block_tags: sentDelta.block_tags,
    };

    // 3. Apply the received delta to our local SQLite DB using LWW conflict merges
    const appliedResult = applySyncDelta(dbInstance, receivedDelta);

    return {
      sentDelta,
      receivedDelta,
      appliedResult,
    };
  }
}
