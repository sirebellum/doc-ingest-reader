import { getDatabaseAdapter } from './backup';
import { generateEmbedding } from '../utils/embeddings';
import { RustParserBridge } from '../native/RustParserBridge';
import { ENABLE_CORE_DEBUG_LOGS, logDebug } from '../utils/logger';

export interface HybridSearchResult {
  id: string;
  content: string;
  keywordScore: number;
  semanticScore: number;
  combinedScore: number;
}

// Helper to convert BLOB buffer/Uint8Array to Float32Array
function toFloat32Array(bytes: any): Float32Array {
  const arrayBuffer = bytes.buffer;
  const byteOffset = bytes.byteOffset || 0;
  const byteLength = bytes.byteLength || bytes.length;
  
  if (byteOffset % 4 === 0) {
    return new Float32Array(arrayBuffer, byteOffset, byteLength / 4);
  } else {
    const slice = arrayBuffer.slice(byteOffset, byteOffset + byteLength);
    return new Float32Array(slice);
  }
}

/**
 * Performs a high-performance hybrid search combining keyword (FTS5 BM25)
 * and semantic vector cosine similarities using Reciprocal Rank Fusion (RRF).
 *
 * @param dbInstance - The database instance (better-sqlite3 or expo-sqlite)
 * @param documentId - The ID of the document to search within
 * @param queryText - The text to search for
 * @param weights - Unused in RRF rank fusion but kept for signature compatibility
 * @param limit - Maximum number of results to return (default: 20)
 * @returns An array of HybridSearchResult sorted by combined RRF score descending
 */
// Removed broken searchHybrid signature

export function fetchKeywordCandidates(db: any, documentId: string, ftsQuery: string) {
  const keywordQuery = `
    SELECT b.id, b.content, -bm25(blocks_fts) as bm25_score
    FROM blocks b
    JOIN blocks_fts ON b.id = blocks_fts.block_id
    WHERE b.document_id = ? AND blocks_fts MATCH ?;
  `;

  let keywordResults: any[] = [];
  try {
    keywordResults = db.all(keywordQuery, [documentId, ftsQuery]);
  } catch (e) {
    try {
      keywordResults = db.all(keywordQuery, [documentId, `"${ftsQuery}"`]);
    } catch (err) {
      keywordResults = [];
    }
  }

  keywordResults.sort((a, b) => b.bm25_score - a.bm25_score);

  let minBM25 = Infinity;
  let maxBM25 = -Infinity;
  keywordResults.forEach((r) => {
    if (r.bm25_score < minBM25) minBM25 = r.bm25_score;
    if (r.bm25_score > maxBM25) maxBM25 = r.bm25_score;
  });

  const keywordScoreMap = new Map<string, number>();
  keywordResults.forEach((r) => {
    let normalized = 1.0;
    if (maxBM25 !== minBM25) {
      normalized = (r.bm25_score - minBM25) / (maxBM25 - minBM25);
    }
    keywordScoreMap.set(r.id, normalized);
  });

  const keywordRankMap = new Map<string, number>();
  keywordResults.forEach((r, idx) => {
    keywordRankMap.set(r.id, idx + 1);
  });

  return { keywordResults, keywordScoreMap, keywordRankMap };
}

export function fetchSemanticCandidates(db: any, documentId: string, queryText: string) {
  const semanticQuery = `
    SELECT b.id, b.content, vc.vector 
    FROM blocks b 
    JOIN vector_cache vc ON b.id = vc.block_id 
    WHERE b.document_id = ?;
  `;
  
  let semanticResults: any[] = [];
  try {
    semanticResults = db.all(semanticQuery, [documentId]);
  } catch (e) {
    semanticResults = [];
  }

  const queryVector = generateEmbedding(queryText);
  let similarityScores: number[] = [];
  if (semanticResults.length > 0) {
    try {
      const Float32QueryVector = new Float32Array(queryVector);
      const candidateVectors = semanticResults.map((r) => toFloat32Array(r.vector));
      similarityScores = RustParserBridge.computeBatchSimilarities(Float32QueryVector, candidateVectors);
    } catch (err) {
      console.warn('[Search] Native batch similarity failed, falling back to JS loops', err);
      const cosineSimilarity = require('../utils/embeddings').cosineSimilarity;
      similarityScores = semanticResults.map((r) => {
        try {
          const parsed = toFloat32Array(r.vector);
          return cosineSimilarity(queryVector, Array.from(parsed));
        } catch {
          return 0;
        }
      });
    }
  }

  const semanticCandidates = semanticResults
    .map((row, idx) => ({
      id: row.id,
      content: row.content,
      score: similarityScores[idx] || 0
    }))
    .filter(c => c.score > 0.15)
    .sort((a, b) => b.score - a.score);

  const semanticRankMap = new Map<string, number>();
  semanticCandidates.forEach((c, idx) => {
    semanticRankMap.set(c.id, idx + 1);
  });

  const semanticScoreMap = new Map<string, number>();
  semanticCandidates.forEach((c) => {
    semanticScoreMap.set(c.id, c.score);
  });

  return { semanticResults, semanticCandidates, semanticScoreMap, semanticRankMap };
}

export function applyReciprocalRankFusion(
  keywordData: ReturnType<typeof fetchKeywordCandidates>,
  semanticData: ReturnType<typeof fetchSemanticCandidates>,
  limit: number
): HybridSearchResult[] {
  const { keywordResults, keywordScoreMap, keywordRankMap } = keywordData;
  const { semanticResults, semanticCandidates, semanticScoreMap, semanticRankMap } = semanticData;

  const allCandidateIds = new Set<string>([
    ...keywordResults.map((r) => r.id),
    ...semanticCandidates.map((r) => r.id)
  ]);

  const combinedResults: HybridSearchResult[] = [];

  allCandidateIds.forEach((id) => {
    const block = semanticResults.find((r) => r.id === id) || keywordResults.find((r) => r.id === id);
    if (!block) return;

    const keywordScore = keywordScoreMap.get(id) || 0;
    const semanticScore = semanticScoreMap.get(id) || 0;

    const kRank = keywordRankMap.get(id);
    const sRank = semanticRankMap.get(id);

    let combinedScore = 0;
    if (kRank !== undefined) {
      combinedScore += 1 / (60 + kRank);
    }
    if (sRank !== undefined) {
      combinedScore += 1 / (60 + sRank);
    }

    if (ENABLE_CORE_DEBUG_LOGS) {
      logDebug(
        'SEARCH',
        'HybridRanker',
        `Reciprocal Rank Fusion (RRF) query score calculated for block. ID: ${id}`,
        `KeywordRank: ${kRank !== undefined ? kRank : 'N/A'}, SemanticRank: ${sRank !== undefined ? sRank : 'N/A'}, RRFScore: ${combinedScore.toFixed(6)}, Status: Success`
      );
    }

    combinedResults.push({
      id,
      content: block.content,
      keywordScore,
      semanticScore,
      combinedScore
    });
  });

  return combinedResults
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, limit);
}

export function searchHybrid(
  dbInstance: any,
  documentId: string,
  queryText: string,
  weights: { keyword: number; semantic: number } = { keyword: 0.5, semantic: 0.5 },
  limit: number = 20
): HybridSearchResult[] {
  const db = getDatabaseAdapter(dbInstance);

  const ftsQuery = queryText.replace(/[^\w\s]/g, ' ').trim();
  if (!ftsQuery) {
    return [];
  }

  const keywordData = fetchKeywordCandidates(db, documentId, ftsQuery);
  const semanticData = fetchSemanticCandidates(db, documentId, queryText);

  return applyReciprocalRankFusion(keywordData, semanticData, limit);
}
