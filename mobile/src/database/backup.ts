import { fuzzyReAnchor, AnchorMetadata, SearchableBlock } from '../utils/anchoring';
import { signPayload, verifyPayload } from '../utils/crypto';
import { mergeThreeWay, computeLCS } from '../utils/merging';
import { ENABLE_CORE_DEBUG_LOGS, logDebug } from '../utils/logger';


export interface DatabaseAdapter {
  all<T>(sql: string, params?: any[]): T[];
  get<T>(sql: string, params?: any[]): T | undefined;
  run(sql: string, params?: any[]): void;
  transaction(fn: () => void): void;
}

/**
 * Creates a DatabaseAdapter from a better-sqlite3 Database instance
 */
export function createBetterSqlite3Adapter(db: any): DatabaseAdapter {
  return {
    all: (sql, params = []) => db.prepare(sql).all(...params),
    get: (sql, params = []) => db.prepare(sql).get(...params),
    run: (sql, params = []) => {
      if (ENABLE_CORE_DEBUG_LOGS) {
        const startTime = Date.now();
        db.prepare(sql).run(...params);
        const duration = Date.now() - startTime;
        logDebug('DATABASE', 'Write', `Executed write query: ${sql}`, `Duration: ${duration}ms, Status: Success`);
        if (sql.includes('INSERT INTO blocks') || sql.includes('UPDATE blocks')) {
          logDebug('DATABASE', 'Trigger', 'FTS5 trigger blocks_fts_ai/au firing -> Extracting plain-text from AST content', 'Trigger: blocks_fts_ai/au');
        }
      } else {
        db.prepare(sql).run(...params);
      }
    },
    transaction: (fn) => {
      if (ENABLE_CORE_DEBUG_LOGS) {
        logDebug('DATABASE', 'Transaction', 'Opening active transaction hook', 'Status: Begin');
      }
      const startTime = Date.now();
      try {
        db.transaction(fn)();
        if (ENABLE_CORE_DEBUG_LOGS) {
          const duration = Date.now() - startTime;
          logDebug('DATABASE', 'Transaction', 'Committed database write transaction successfully', `Duration: ${duration}ms, Status: Success`);
        }
      } catch (e: any) {
        if (ENABLE_CORE_DEBUG_LOGS) {
          const duration = Date.now() - startTime;
          logDebug('DATABASE', 'Transaction', `Rolled back database write transaction due to error: ${e.message}`, `Duration: ${duration}ms, Status: Rollback`);
        }
        throw e;
      }
    },
  };
}

/**
 * Creates a DatabaseAdapter from an expo-sqlite SQLiteDatabase instance
 */
export function createExpoSqliteAdapter(db: any): DatabaseAdapter {
  return {
    all: (sql, params = []) => db.getAllSync(sql, ...params),
    get: (sql, params = []) => db.getFirstSync(sql, ...params) || undefined,
    run: (sql, params = []) => {
      if (ENABLE_CORE_DEBUG_LOGS) {
        const startTime = Date.now();
        db.runSync(sql, ...params);
        const duration = Date.now() - startTime;
        logDebug('DATABASE', 'Write', `Executed write query: ${sql}`, `Duration: ${duration}ms, Status: Success`);
        if (sql.includes('INSERT INTO blocks') || sql.includes('UPDATE blocks')) {
          logDebug('DATABASE', 'Trigger', 'FTS5 trigger blocks_fts_ai/au firing -> Extracting plain-text from AST content', 'Trigger: blocks_fts_ai/au');
        }
      } else {
        db.runSync(sql, ...params);
      }
    },
    transaction: (fn) => {
      if (ENABLE_CORE_DEBUG_LOGS) {
        logDebug('DATABASE', 'Transaction', 'Opening active transaction hook', 'Status: Begin');
      }
      const startTime = Date.now();
      try {
        db.withTransactionSync(fn);
        if (ENABLE_CORE_DEBUG_LOGS) {
          const duration = Date.now() - startTime;
          logDebug('DATABASE', 'Transaction', 'Committed database write transaction successfully', `Duration: ${duration}ms, Status: Success`);
        }
      } catch (e: any) {
        if (ENABLE_CORE_DEBUG_LOGS) {
          const duration = Date.now() - startTime;
          logDebug('DATABASE', 'Transaction', `Rolled back database write transaction due to error: ${e.message}`, `Duration: ${duration}ms, Status: Rollback`);
        }
        throw e;
      }
    },
  };
}

/**
 * Gets a DatabaseAdapter dynamically by inspecting the db instance
 */
export function getDatabaseAdapter(db: any): DatabaseAdapter {
  if (db && typeof db.prepare === 'function') {
    return createBetterSqlite3Adapter(db);
  } else if (db && (typeof db.getAllSync === 'function' || typeof db.execSync === 'function')) {
    return createExpoSqliteAdapter(db);
  } else {
    throw new Error('Unsupported database instance. Must be either better-sqlite3 or expo-sqlite.');
  }
}

export interface ExportedAnnotation {
  id: string;
  annotation_type: string;
  color_code: string;
  highlighted_text: string | null;
  note_body: string | null;
  anchor_metadata: string | null; // JSON string
  created_at: string;
  updated_at: string;
  tags: string[];
  author_id?: string;
}

export interface ExportedDocument {
  title: string;
  author: string | null;
  source_type: string;
  sha256_hash: string;
  metadata?: string | null;
}

export interface BackupPayload {
  schema_version: string;
  document: ExportedDocument;
  annotations: ExportedAnnotation[];
  signature?: string;
  publicKey?: string;
  author_id?: string;
}

export interface ImportResult {
  status: 'success' | 'document_not_found' | 'signature_invalid';
  importedCount: number;
  skippedCount: number;
  fuzzyReAnchorCount: number;
  orphanedCount: number;
  targetDocumentId?: string;
  docTitle?: string;
  sha256?: string;
}

/**
 * Compiles a secure JSON note packet for a document (copyright preserving, no raw source text).
 */
export function exportDocumentNotesBackup(
  dbInstance: any,
  documentId: string,
  privateKeyPem?: string,
  publicKeyPem?: string
): BackupPayload {
  const db = getDatabaseAdapter(dbInstance);

  const doc = db.get<any>(
    'SELECT title, author, source_type, sha256_hash, metadata FROM documents WHERE id = ?;',
    [documentId]
  );
  if (!doc) {
    throw new Error(`Document with ID ${documentId} not found.`);
  }

  const annotations = db.all<any>(
    'SELECT id, block_id, annotation_type, color_code, highlighted_text, note_body, anchor_metadata, author_id, created_at, updated_at FROM annotations WHERE document_id = ?;',
    [documentId]
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

  const basePayload: BackupPayload = {
    schema_version: '1.0',
    document: {
      title: doc.title,
      author: doc.author,
      source_type: doc.source_type,
      sha256_hash: doc.sha256_hash,
      metadata: doc.metadata,
    },
    annotations: exportedAnnotations,
  };

  if (privateKeyPem && publicKeyPem) {
    const verificationObject = {
      schema_version: basePayload.schema_version,
      document: basePayload.document,
      annotations: basePayload.annotations,
    };
    basePayload.signature = signPayload(JSON.stringify(verificationObject), privateKeyPem);
    basePayload.publicKey = publicKeyPem;
    basePayload.author_id = `author-${doc.sha256_hash.substring(0, 8)}`;
  }

  return basePayload;
}

/**
 * Imports shared note packets, performing FTS5 context re-anchoring, upserts, and multi-author merging.
 */
export function importDocumentNotesBackup(dbInstance: any, payload: BackupPayload): ImportResult {
  const db = getDatabaseAdapter(dbInstance);
  const { document, annotations } = payload;

  // 0. Signature Verification to assert authorship integrity and prevent tampering
  if (payload.signature && payload.publicKey) {
    const verificationObject = {
      schema_version: payload.schema_version,
      document: payload.document,
      annotations: payload.annotations,
    };
    const isValid = verifyPayload(JSON.stringify(verificationObject), payload.signature, payload.publicKey);
    if (!isValid) {
      return {
        status: 'signature_invalid',
        importedCount: 0,
        skippedCount: 0,
        fuzzyReAnchorCount: 0,
        orphanedCount: 0,
        docTitle: document.title,
        sha256: document.sha256_hash,
      };
    }
  }

  // 1. Search for document by sha256_hash
  let targetDoc = db.get<any>('SELECT * FROM documents WHERE sha256_hash = ?;', [document.sha256_hash]);
  let fuzzyReAnchorNeeded = false;

  // Metadata Fallback Reader: Search by title/author if hash differs
  if (!targetDoc) {
    targetDoc = db.get<any>(
      'SELECT * FROM documents WHERE title = ? AND (author = ? OR (author IS NULL AND ? IS NULL));',
      [document.title, document.author, document.author]
    );
    if (targetDoc) {
      fuzzyReAnchorNeeded = true;
    }
  }

  // If no document exists in the system, isolate / trigger metadata fallback notice
  if (!targetDoc) {
    return {
      status: 'document_not_found',
      importedCount: 0,
      skippedCount: 0,
      fuzzyReAnchorCount: 0,
      orphanedCount: 0,
      docTitle: document.title,
      sha256: document.sha256_hash,
    };
  }

  const documentId = targetDoc.id;
  let importedCount = 0;
  let skippedCount = 0;
  let fuzzyReAnchorCount = 0;
  let orphanedCount = 0;

  // Pre-fetch target document blocks for potential fuzzy alignment searches
  // We can load them on-demand or pre-cache
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
    for (const ann of annotations) {
      let finalNoteBody = ann.note_body;
      // Check if annotation ID (UUID) already exists for deduplicated upserts
      const existing = db.get<any>('SELECT id, note_body, author_id, updated_at FROM annotations WHERE id = ?;', [ann.id]);
      if (existing) {
        const incomingAuthor = ann.author_id || payload.author_id;
        const existingAuthor = existing.author_id;
        if (incomingAuthor && existingAuthor && incomingAuthor !== existingAuthor && ann.note_body !== existing.note_body) {
          // Perform Myers 3-way merge using LCS as base
          const baseText = computeLCS(existing.note_body || '', ann.note_body || '');
          const mergeRes = mergeThreeWay(baseText, existing.note_body || '', ann.note_body || '');
          finalNoteBody = mergeRes.mergedText;
        } else {
          // Upsert Matching UUIDs: retains/overwrites only if imported is newer
          const importedTime = new Date(ann.updated_at).getTime();
          const existingTime = new Date(existing.updated_at).getTime();
          if (importedTime <= existingTime) {
            skippedCount++;
            continue;
          }
        }
      }

      // Resolve the anchor block in the target database
      let resolvedBlockId: string | null = null;
      let finalAnchorMetadata = ann.anchor_metadata;

      if (ann.highlighted_text) {
        // Attempt to find exact block via FTS5 if SHA-256 matches and block exists
        let foundBlock = false;

        // Extract metadata parsing
        let anchorMeta: AnchorMetadata = { prefix: '', suffix: '', offset: 0 };
        if (ann.anchor_metadata) {
          try {
            anchorMeta = JSON.parse(ann.anchor_metadata);
          } catch {}
        }

        if (!fuzzyReAnchorNeeded) {
          // Verify if the current block_id exists and holds the highlighted_text
          const checkBlock = db.get<any>(
            'SELECT b.id, fts.content as text FROM blocks b JOIN blocks_fts fts ON b.id = fts.block_id WHERE b.id = ? AND b.document_id = ?;',
            [ann.id, documentId] // Wait, checking target block matching imported ID or block index
          );
          // Let's search using FTS5 for blocks containing the highlighted text within this document first!
          // This is extremely robust and fast.
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
                // Re-calculate context offsets
                anchorMeta.offset = idx;
                finalAnchorMetadata = JSON.stringify(anchorMeta);
                foundBlock = true;
              }
            }
          }
        }

        // Fuzzy Re-anchoring Engine
        if (!foundBlock) {
          // Get candidate blocks utilizing FTS5 query terms if possible, otherwise load all
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
          // If no high-confidence block match can be found (confidence score < 0.4), isolate
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
        // Bookmark or note without highlighted text goes to Orphaned Notes by default
        resolvedBlockId = null;
        orphanedCount++;
      }

      // Write or Overwrite the record
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
          ann.author_id || payload.author_id || 'peer',
          ann.created_at,
          ann.updated_at,
        ]
      );

      // Manage imported tags
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

      importedCount++;
    }
  });

  return {
    status: 'success',
    importedCount,
    skippedCount,
    fuzzyReAnchorCount,
    orphanedCount,
    targetDocumentId: documentId,
  };
}
