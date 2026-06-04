// Mock expo-sqlite before native imports
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn().mockReturnValue({
    execSync: jest.fn(),
  }),
}));

import Database from 'better-sqlite3';
import { INITIALIZE_DATABASE_SCHEMA } from '../schema';
import { generateEmbedding, cosineSimilarity } from '../../utils/embeddings';
import { searchHybrid } from '../search';
import { RustParserBridge } from '../../native/RustParserBridge';

describe('Hybrid Search Engine & Vector Embeddings Integration', () => {
  let db: Database.Database;
  const corpId = 'corp-search-test';
  const docId = 'doc-search-test';
  const secId = 'sec-search-test';

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(INITIALIZE_DATABASE_SCHEMA);

    // Seed relational structure
    db.prepare(`
      INSERT INTO corpora (id, name) VALUES (?, 'Search Test Corpus');
    `).run(corpId);

    db.prepare(`
      INSERT INTO documents (id, corpus_id, title, sha256_hash, storage_path)
      VALUES (?, ?, 'Search Integration Document', 'search_doc_sha_256', '/sandbox/search.pdf');
    `).run(docId, corpId);

    db.prepare(`
      INSERT INTO sections (id, document_id, title, sort_order)
      VALUES (?, ?, 'Search Ingestion Chapter 1', 1);
    `).run(secId, docId);
  });

  afterEach(() => {
    db.close();
  });

  describe('Vector Properties', () => {
    it('should generate a 384-dimensional unit vector', () => {
      const text = 'This is advanced database sync operations.';
      const vector = generateEmbedding(text);

      expect(vector).toBeDefined();
      expect(vector.length).toBe(384);

      // Verify L2 norm equals 1.0 (unit vector property)
      const l2norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
      expect(l2norm).toBeCloseTo(1.0, 5);
    });

    it('should compute exact cosine similarity dot products', () => {
      const text1 = 'High performance JSI bridges allow offline mobile neural targets.';
      const text2 = 'High performance JSI bridges allow offline mobile neural targets.';
      const text3 = 'Completely unrelated string context.';

      const v1 = generateEmbedding(text1);
      const v2 = generateEmbedding(text2);
      const v3 = generateEmbedding(text3);

      const simIdentical = cosineSimilarity(v1, v2);
      const simDifferent = cosineSimilarity(v1, v3);

      expect(simIdentical).toBeCloseTo(1.0, 5);
      expect(simDifferent).toBeLessThan(0.7);
    });
  });

  describe('Hybrid Plain-Text (BM25) and Semantic search', () => {
    it('should combine FTS5 BM25 and vector similarities to rank query results', () => {
      const blocksData = [
        { id: 'b1', text: '<p>SQLite database uses native triggers to synchronize FTS5 index tables.</p>', order: 1 },
        { id: 'b2', text: '<p>Standard offline local inference is executed via compiled llama.cpp libraries.</p>', order: 2 },
        { id: 'b3', text: '<p>Sharing sheets export note packets securely checking SHA-256 signatures.</p>', order: 3 },
      ];

      // Insert blocks into database (which automatically populates blocks_fts via trigger!)
      const insertBlock = db.prepare(`
        INSERT INTO blocks (id, section_id, document_id, block_type, content, sort_order)
        VALUES (?, ?, ?, 'paragraph', ?, ?);
      `);
      blocksData.forEach((b) => insertBlock.run(b.id, secId, docId, b.text, b.order));

      // Generate and insert vector embeddings into binary BLOB cache table
      const insertVectorCache = db.prepare(`
        INSERT INTO vector_cache (block_id, vector)
        VALUES (?, ?);
      `);

      blocksData.forEach((b) => {
        const plainText = b.text.replace(/<[^>]*>/g, '').trim();
        const vector = generateEmbedding(plainText);

        // Binary vector_cache BLOB save
        const floatVec = new Float32Array(vector);
        const bufferVal = Buffer.from(floatVec.buffer, floatVec.byteOffset, floatVec.byteLength);
        insertVectorCache.run(b.id, bufferVal);
      });

      // Execute search queries
      const query1 = 'SQLite';
      const results1 = searchHybrid(db, docId, query1, { keyword: 0.5, semantic: 0.5 }, 10);

      expect(results1.length).toBeGreaterThan(0);
      expect(results1[0].id).toBe('b1'); // Best match is b1 (exact keywords and semantics)
      expect(results1[0].keywordScore).toBeCloseTo(1.0, 5);

      const query2 = 'inference';
      const results2 = searchHybrid(db, docId, query2, { keyword: 0.2, semantic: 0.8 }, 10);

      expect(results2.length).toBeGreaterThan(0);
      expect(results2[0].id).toBe('b2'); // Best match is b2
      expect(results2[0].semanticScore).toBeGreaterThan(0.3);
    });
  });

  describe('JSI Similarity Bridge & Fallbacks', () => {
    it('should compute accurate cosine similarity using RustParserBridge fallback JSI methods', () => {
      const vecA = Float32Array.from([1.0, 2.0, 3.0]);
      const vecB = Float32Array.from([1.0, 2.0, 3.0]);
      const vecC = Float32Array.from([-1.0, -2.0, -3.0]);

      const simIdentical = RustParserBridge.computeSimilarity(vecA, vecB);
      const simOpposite = RustParserBridge.computeSimilarity(vecA, vecC);

      expect(simIdentical).toBeCloseTo(1.0, 5);
      expect(simOpposite).toBeCloseTo(-1.0, 5);
    });

    it('should compute batch similarities correctly using RustParserBridge fallback JSI methods', () => {
      const targetVec = Float32Array.from([1.0, 0.0, 0.0]);
      const candidateVecs = [
        Float32Array.from([1.0, 0.0, 0.0]),
        Float32Array.from([0.0, 1.0, 0.0]),
        Float32Array.from([0.5, 0.5, 0.0]),
      ];

      const results = RustParserBridge.computeBatchSimilarities(targetVec, candidateVecs);

      expect(results).toHaveLength(3);
      expect(results[0]).toBeCloseTo(1.0, 5);
      expect(results[1]).toBeCloseTo(0.0, 5);
      expect(results[2]).toBeCloseTo(1 / Math.sqrt(2), 5); // 0.5 / sqrt(0.5)
    });
  });

  describe('Reciprocal Rank Fusion RRF Math Verification', () => {
    it('should compute exact RRF scores based on rank positions', () => {
      const mockResults = [
        { id: 'b1', keywordRank: 1, semanticRank: 1 },
        { id: 'b2', keywordRank: 2, semanticRank: 3 },
        { id: 'b3', keywordRank: 3, semanticRank: 2 },
      ];

      // Simulate RRF calculation manually
      const rrfScores = mockResults.map((item) => {
        const r_keyword = item.keywordRank;
        const r_semantic = item.semanticRank;
        return 1 / (60 + r_keyword) + 1 / (60 + r_semantic);
      });

      // Verify expected scores
      expect(rrfScores[0]).toBeCloseTo(1 / 61 + 1 / 61, 5); // 1/(60+1) + 1/(60+1)
      expect(rrfScores[1]).toBeCloseTo(1 / 62 + 1 / 63, 5); // 1/(60+2) + 1/(60+3)
      expect(rrfScores[2]).toBeCloseTo(1 / 63 + 1 / 62, 5); // 1/(60+3) + 1/(60+2)

      // Verify ranking order
      const sorted = mockResults.sort((a, b) => {
        const scoreA = 1 / (60 + a.keywordRank) + 1 / (60 + a.semanticRank);
        const scoreB = 1 / (60 + b.keywordRank) + 1 / (60 + b.semanticRank);
        return scoreB - scoreA;
      });

      expect(sorted[0].id).toBe('b1');
      expect(sorted[1].id).toBe('b2');
      expect(sorted[2].id).toBe('b3');
    });
  });
});
