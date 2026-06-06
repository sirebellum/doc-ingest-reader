import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';

export let db: any;
export let webDbError: string | null = null;

if (Platform.OS === 'web') {
  if (process.env.NODE_ENV === 'test') {
    let annotations: any[] = [
      {
        id: 'mock_ann_1',
        document_id: 'mock_doc_test',
        block_id: 'mock_block_2',
        annotation_type: 'highlight',
        color_code: '#ffeb3b',
        highlighted_text: 'JSI native hooks',
        note_body: 'synthetic_simulation_stub: This is a note about JSI native hooks.',
        anchor_metadata: JSON.stringify({ is_mock: true, origin: 'synthetic_simulation_stub' }),
        author_id: 'mock_dev_user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ];

    db = {
      execSync: (sql: string) => {
        console.log('[Mock DB] execSync:', sql);
      },
      execAsync: async (sql: string) => {
        console.log('[Mock DB] execAsync:', sql);
      },
      runAsync: async (sql: string, params: any[] = []) => {
        console.log('[Mock DB] runAsync:', sql, params);
        if (sql.includes('INSERT INTO annotations') || sql.includes('INSERT OR REPLACE INTO annotations')) {
          const [id, document_id, block_id, annotation_type, color_code, highlighted_text, note_body, anchor_metadata, author_id] = params;
          const existingIdx = annotations.findIndex(a => a.id === id);
          const newAnn = {
            id, document_id, block_id, annotation_type, color_code, highlighted_text, note_body, anchor_metadata, author_id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          if (existingIdx >= 0) {
            annotations[existingIdx] = newAnn;
          } else {
            annotations.push(newAnn);
          }
        } else if (sql.includes('DELETE FROM annotations WHERE id = ?')) {
          const id = params[0];
          annotations = annotations.filter(a => a.id !== id);
        }
        return { changes: 1, lastInsertRowId: 1 };
      },
      getAllAsync: async (sql: string, params: any[] = []) => {
        console.log('[Mock DB] getAllAsync:', sql, params);
        const normalizedSql = sql.trim().toLowerCase();
        
        if (normalizedSql.includes('from corpora')) {
          return [
            {
              id: 'mock_corpus_test',
              name: 'mock_Local Ingests',
              description: 'synthetic_simulation_stub: Collection of documents ingested locally via desktop CLI test runner.'
            }
          ];
        }
        
        if (normalizedSql.includes('from documents')) {
          return [
            {
              id: 'mock_doc_test',
              corpus_id: 'mock_corpus_test',
              title: 'mock_Research Notes.pdf',
              author: 'mock_Unknown Author',
              source_type: 'pdf',
              sha256_hash: 'mock_hash_123',
              storage_path: 'mock_Research Notes.pdf',
              metadata: JSON.stringify({ is_mock: true, origin: 'synthetic_simulation_stub' }),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }
          ];
        }
        
        if (normalizedSql.includes('from sections')) {
          return [
            {
              id: 'mock_sec_1',
              document_id: 'mock_doc_test',
              parent_id: null,
              title: 'synthetic_simulation_stub: Chapter 1: Native Bridges',
              depth_level: 1,
              sort_order: 1,
              created_at: new Date().toISOString()
            },
            {
              id: 'mock_sec_2',
              document_id: 'mock_doc_test',
              parent_id: null,
              title: 'synthetic_simulation_stub: Chapter 2: Offline Databases',
              depth_level: 1,
              sort_order: 2,
              created_at: new Date().toISOString()
            }
          ];
        }
        
        if (normalizedSql.includes('from blocks')) {
          const sectionId = params[0] || '';
          if (sectionId === 'mock_sec_2') {
            return [
              {
                id: 'mock_block_3',
                section_id: 'mock_sec_2',
                document_id: 'mock_doc_test',
                block_type: 'heading',
                content: JSON.stringify({
                  type: 'heading',
                  level: 2,
                  children: [{ type: 'text', text: 'synthetic_simulation_stub: Chapter 2: Offline Databases', bold: null, italic: null, code: null }]
                }),
                sort_order: 1,
                token_count: 5,
                created_at: new Date().toISOString()
              },
              {
                id: 'mock_block_4',
                section_id: 'mock_sec_2',
                document_id: 'mock_doc_test',
                block_type: 'paragraph',
                content: JSON.stringify({
                  type: 'paragraph',
                  children: [{ type: 'text', text: 'synthetic_simulation_stub: Detailed study of SQLite relational schemas, FTS5 virtual tables, and conflict merging.', bold: null, italic: null, code: null }]
                }),
                sort_order: 2,
                token_count: 15,
                created_at: new Date().toISOString()
              }
            ];
          }
          
          return [
            {
              id: 'mock_block_1',
              section_id: 'mock_sec_1',
              document_id: 'mock_doc_test',
              block_type: 'heading',
              content: JSON.stringify({
                type: 'heading',
                level: 2,
                children: [{ type: 'text', text: 'synthetic_simulation_stub: Chapter 1: Native Bridges', bold: null, italic: null, code: null }]
              }),
              sort_order: 1,
              token_count: 5,
              created_at: new Date().toISOString()
            },
            {
              id: 'mock_block_2',
              section_id: 'mock_sec_1',
              document_id: 'mock_doc_test',
              block_type: 'paragraph',
              content: JSON.stringify({
                type: 'paragraph',
                children: [{ type: 'text', text: 'synthetic_simulation_stub: This chapter explains native JSI hooks, NPU neural shaders, and memory heap diagnostics.', bold: null, italic: null, code: null }]
              }),
              sort_order: 2,
              token_count: 15,
              created_at: new Date().toISOString()
            }
          ];
        }
        
        if (normalizedSql.includes('from annotations')) {
          return annotations;
        }
        
        return [];
      }
    };
  } else {
    let dbInstance: any = null;
    let initPromise: Promise<any> | null = null;
    webDbError = null;

    const getDbInstance = async (): Promise<any> => {
      if (dbInstance) return dbInstance;
      if (initPromise) return initPromise;

      initPromise = (async () => {
        try {
          console.log('[Web DB] Initializing sql.js...');
          const initSqlJs = require('sql.js');
          const SQL = await initSqlJs({
            locateFile: (file: string) => {
              if (file.endsWith('.wasm')) {
                return 'https://unpkg.com/sql.js@1.14.1/dist/sql-wasm.wasm';
              }
              return `https://unpkg.com/sql.js@1.14.1/dist/${file}`;
            }
          });

          console.log('[Web DB] Fetching database file from gateway...');
          const response = await fetch('http://localhost:8080/db');
          if (!response.ok) {
            throw new Error(`Gateway returned status ${response.status} ${response.statusText}`);
          }

          const arrayBuffer = await response.arrayBuffer();
          console.log('[Web DB] Loaded database file, size in bytes:', arrayBuffer.byteLength);
          const instance = new SQL.Database(new Uint8Array(arrayBuffer));
          dbInstance = instance;
          webDbError = null;
          return dbInstance;
        } catch (error: any) {
          const errMsg = error?.message || String(error);
          console.error('[Web DB] Failed to fetch or load SQLite DB:', errMsg);
          webDbError = errMsg;
          initPromise = null;
          throw new Error(`Database connection failed: ${errMsg}`);
        }
      })();

      return initPromise;
    };

    db = {
      execSync: (sql: string) => {
        if (dbInstance) {
          dbInstance.run(sql);
        } else {
          console.warn('[Web DB] execSync called but DB is not loaded yet. Ignoring.');
        }
      },
      execAsync: async (sql: string) => {
        const instance = await getDbInstance();
        instance.run(sql);
      },
      runAsync: async (sql: string, params: any[] = []) => {
        const instance = await getDbInstance();
        instance.run(sql, params);
        const changes = instance.getRowsModified();
        let lastInsertRowId = 0;
        try {
          const res = instance.exec("SELECT last_insert_rowid() AS id");
          if (res.length > 0 && res[0].values.length > 0) {
            lastInsertRowId = Number(res[0].values[0][0]);
          }
        } catch (e) {
          // Ignore
        }
        return { changes, lastInsertRowId };
      },
      getAllAsync: async (sql: string, params: any[] = []) => {
        const instance = await getDbInstance();
        const stmt = instance.prepare(sql);
        stmt.bind(params);
        const rows: any[] = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
      }
    };
  }
} else {
  db = SQLite.openDatabaseSync('llm_pdf_reader.db');
}

export const JSON_EXTRACT_MACRO = `CASE 
  WHEN json_valid(new.content) THEN (SELECT group_concat(value, ' ') FROM json_tree(new.content) WHERE key IN ('text', 'code', 'alt', 'caption'))
  ELSE new.content
END`;

export const INITIALIZE_DATABASE_SCHEMA = `
  PRAGMA foreign_keys = ON;

  -- 1. Corpora Table
  CREATE TABLE IF NOT EXISTS corpora (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  -- 2. Documents Table
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    corpus_id TEXT REFERENCES corpora(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    author TEXT,
    source_type TEXT DEFAULT 'pdf' NOT NULL,
    sha256_hash TEXT NOT NULL,
    metadata TEXT,
    storage_path TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  -- 3. Sections Table
  CREATE TABLE IF NOT EXISTS sections (
    id TEXT PRIMARY KEY,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    depth_level INTEGER DEFAULT 1 NOT NULL,
    sort_order INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  -- 4. Blocks Table
  CREATE TABLE IF NOT EXISTS blocks (
    id TEXT PRIMARY KEY,
    section_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    block_type TEXT DEFAULT 'paragraph' NOT NULL,
    content TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    token_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  -- 5. Annotations Table
  CREATE TABLE IF NOT EXISTS annotations (
    id TEXT PRIMARY KEY,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    block_id TEXT REFERENCES blocks(id) ON DELETE CASCADE,
    annotation_type TEXT DEFAULT 'highlight' NOT NULL,
    color_code TEXT,
    highlighted_text TEXT,
    note_body TEXT,
    anchor_metadata TEXT,
    author_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  -- 6. Tags Table
  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  -- 7. Block Tags Table
  CREATE TABLE IF NOT EXISTS block_tags (
    block_id TEXT REFERENCES blocks(id) ON DELETE CASCADE,
    tag_id TEXT REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (block_id, tag_id)
  );

  -- 8. Processing Jobs Table
  CREATE TABLE IF NOT EXISTS processing_jobs (
    id TEXT PRIMARY KEY,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending' NOT NULL,
    progress_percentage INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  -- 9. Job Chunks Table
  CREATE TABLE IF NOT EXISTS job_chunks (
    id TEXT PRIMARY KEY,
    job_id TEXT REFERENCES processing_jobs(id) ON DELETE CASCADE,
    raw_text TEXT NOT NULL,
    chunk_order INTEGER NOT NULL,
    status TEXT DEFAULT 'pending' NOT NULL,
    processed_blocks TEXT
  );

  -- 10. Layout Height Cache Table
  CREATE TABLE IF NOT EXISTS layout_height_cache (
    block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,
    estimated_height REAL NOT NULL
  );

  -- 11. Vector Cache Table
  CREATE TABLE IF NOT EXISTS vector_cache (
    block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,
    vector BLOB NOT NULL
  );

  -- 12. Sync Triggers for FTS5 full-text indexing
  CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
    block_id UNINDEXED,
    content
  );

  -- Triggers to keep FTS5 synchronized with blocks table (JSON AST aware)
  CREATE TRIGGER IF NOT EXISTS blocks_fts_ai AFTER INSERT ON blocks BEGIN
    INSERT INTO blocks_fts(block_id, content)
    VALUES (
      new.id,
      ${JSON_EXTRACT_MACRO}
    );
  END;

  CREATE TRIGGER IF NOT EXISTS blocks_fts_ad AFTER DELETE ON blocks BEGIN
    DELETE FROM blocks_fts WHERE block_id = old.id;
  END;

  CREATE TRIGGER IF NOT EXISTS blocks_fts_au AFTER UPDATE ON blocks BEGIN
    DELETE FROM blocks_fts WHERE block_id = old.id;
    INSERT INTO blocks_fts(block_id, content)
    VALUES (
      new.id,
      ${JSON_EXTRACT_MACRO}
    );
  END;

`;

export function setupDatabase() {
  db.execSync(INITIALIZE_DATABASE_SCHEMA);
}
