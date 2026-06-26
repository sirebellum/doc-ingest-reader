import initSqlJs from 'sql.js';

let dbInstance: any = null;

async function getDb() {
  if (dbInstance) return dbInstance;
  // Use unpkg to fetch the wasm file for sql.js
  const SQL = await initSqlJs({ locateFile: file => `https://unpkg.com/sql.js@1.14.1/dist/${file}` });
  try {
    const gatewayUrl = process.env.EXPO_PUBLIC_DB_GATEWAY || 'http://localhost:8080';
    const response = await fetch(`${gatewayUrl}/db`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const buf = await response.arrayBuffer();
    dbInstance = new SQL.Database(new Uint8Array(buf));
  } catch (e) {
    console.error("Failed to load DB from backend, falling back to empty DB", e);
    dbInstance = new SQL.Database();
  }
  return dbInstance;
}

function execQuery(db: any, sql: string, params: any[] = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

export const DbsBridge = {
  async getCorporaAsync(): Promise<any[]> {
    const db = await getDb();
    return execQuery(db, "SELECT * FROM corpora");
  },
  async getDocumentsAsync(): Promise<any[]> {
    const db = await getDb();
    return execQuery(db, "SELECT * FROM documents");
  },
  async getSectionsForDocumentAsync(documentId: string): Promise<any[]> {
    const db = await getDb();
    const sections = execQuery(db, "SELECT * FROM sections WHERE document_id = ? ORDER BY sort_order", [documentId]);
    if (sections.length === 0) {
      // Check if there are any blocks for this document
      const blocks = execQuery(db, "SELECT id FROM blocks WHERE document_id = ? LIMIT 1", [documentId]);
      if (blocks.length > 0) {
        return [{
          id: `__unlinked__${documentId}`,
          document_id: documentId,
          parent_id: null,
          title: "Full Document",
          depth_level: 1,
          sort_order: 0,
          created_at: new Date().toISOString()
        }];
      }
    }
    return sections;
  },
  async getBlocksForSectionAsync(sectionId: string): Promise<any[]> {
    const db = await getDb();
    if (sectionId && sectionId.startsWith('__unlinked__')) {
      const docId = sectionId.replace('__unlinked__', '');
      return execQuery(db, "SELECT * FROM blocks WHERE document_id = ? AND section_id IS NULL ORDER BY sort_order", [docId]);
    }
    return execQuery(db, "SELECT * FROM blocks WHERE section_id = ? ORDER BY sort_order", [sectionId]);
  },
  async getAnnotationsForBlocksAsync(blockIds: string[]): Promise<any[]> {
    if (blockIds.length === 0) return [];
    const db = await getDb();
    const placeholders = blockIds.map(() => '?').join(',');
    return execQuery(db, `SELECT * FROM annotations WHERE block_id IN (${placeholders})`, blockIds);
  },
  async saveAnnotationAsync(annotation: any): Promise<void> {
    const db = await getDb();
    try {
      db.run(`INSERT OR REPLACE INTO annotations (id, document_id, block_id, annotation_type, color_code, highlighted_text, note_body, anchor_metadata, author_id) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
              [annotation.id, annotation.document_id, annotation.block_id, annotation.annotation_type, annotation.color_code, annotation.highlighted_text, annotation.note_body, annotation.anchor_metadata, annotation.author_id]);
    } catch(e) { console.error(e); }
  },
  async deleteAnnotationAsync(annotationId: string): Promise<void> {
    const db = await getDb();
    try { db.run("DELETE FROM annotations WHERE id = ?", [annotationId]); } catch(e) {}
  },
  async getOrCacheLayoutHeightAsync(blockId: string, estimatedHeight: number): Promise<number> {
    return estimatedHeight;
  },
  async evictLayoutHeightCacheAsync(): Promise<void> {},
  async clearDatabaseAsync(): Promise<void> {},
  async getTagsWithAuthorsAsync(): Promise<any[]> { return []; },
  async getTagCooccurrencesAsync(): Promise<any[]> { return []; },
  async searchBlocksAsync(query: string): Promise<any[]> { return []; },
  async getFirstDocumentIdAsync(): Promise<{ id: string } | null> {
    const db = await getDb();
    const res = execQuery(db, "SELECT id FROM documents LIMIT 1");
    return res.length > 0 ? res[0] as any : null;
  },
  async getConflictingAnnotationsAsync(): Promise<any[]> { return []; },
  async resolveAnnotationConflictAsync(annotationId: string, resolvedText: string): Promise<void> {},
  async getVectorAsync(blockId: string): Promise<Uint8Array | undefined> { return undefined; },
  async setVectorAsync(blockId: string, vector: Uint8Array): Promise<void> {}
};

export const setupDatabase = async () => {};
