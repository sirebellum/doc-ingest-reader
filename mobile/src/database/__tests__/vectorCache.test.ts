// Mock expo-sqlite before native imports
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn().mockReturnValue({
    execSync: jest.fn(),
  }),
}));

import { VectorLRUCache } from '../vectorCache';
import { RustParserBridge } from '../../native/RustParserBridge';
import Database from 'better-sqlite3';
import { INITIALIZE_DATABASE_SCHEMA } from '../schema';

describe('VectorLRUCache', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('should update recency when getting items and evict based on LRU', async () => {
    const cache = new VectorLRUCache(3);

    // Mock high available RAM to prevent aggressive memory evictions
    jest.spyOn(RustParserBridge, 'getHeapStats').mockResolvedValue(
      JSON.stringify({
        total_allocated_bytes: 350_000_000,
        active_context_bytes: 250_000_000,
        peak_allocated_bytes: 400_000_000,
        system_memory_limit_bytes: 1_800_000_000,
        available_system_ram_bytes: 1_000_000_000,
      })
    );

    // Add items
    await cache.set('key1', [1, 2, 3]);
    await cache.set('key2', [4, 5, 6]);
    await cache.set('key3', [7, 8, 9]);

    // Access key1 to update recency
    expect(cache.get('key1')).toEqual(Float32Array.from([1, 2, 3]));

    // Add a new item that should evict the oldest (key2)
    await cache.set('key4', [10, 11, 12]);

    // key1 should still be present, key2 should be evicted
    expect(cache.get('key1')).toEqual(Float32Array.from([1, 2, 3]));
    expect(cache.get('key2')).toBeUndefined();
    expect(cache.get('key3')).toEqual(Float32Array.from([7, 8, 9]));
    expect(cache.get('key4')).toEqual(Float32Array.from([10, 11, 12]));
  });

  it('should evict oldest items when exceeding maxSize', async () => {
    const cache = new VectorLRUCache(2);

    jest.spyOn(RustParserBridge, 'getHeapStats').mockResolvedValue(
      JSON.stringify({
        total_allocated_bytes: 350_000_000,
        active_context_bytes: 250_000_000,
        peak_allocated_bytes: 400_000_000,
        system_memory_limit_bytes: 1_800_000_000,
        available_system_ram_bytes: 1_000_000_000,
      })
    );

    await cache.set('key1', [1, 2, 3]);
    await cache.set('key2', [4, 5, 6]);
    await cache.set('key3', [7, 8, 9]);

    // Should evict key1, keep key2 and key3
    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toEqual(Float32Array.from([4, 5, 6]));
    expect(cache.get('key3')).toEqual(Float32Array.from([7, 8, 9]));
  });

  it('should handle memory enforcement with low available RAM', async () => {
    // Mock heap stats to simulate low available RAM
    jest.spyOn(RustParserBridge, 'getHeapStats').mockResolvedValue(
      JSON.stringify({
        total_allocated_bytes: 350_000_000,
        active_context_bytes: 250_000_000,
        peak_allocated_bytes: 400_000_000,
        system_memory_limit_bytes: 1_800_000_000,
        available_system_ram_bytes: 100_000_000, // < 150MB
      })
    );

    const cache = new VectorLRUCache(5);

    // Add items
    await cache.set('key1', [1, 2, 3]);
    await cache.set('key2', [4, 5, 6]);
    await cache.set('key3', [7, 8, 9]);
    await cache.set('key4', [10, 11, 12]);
    await cache.set('key5', [13, 14, 15]);

    // Add a new item which should trigger aggressive eviction
    await cache.set('key6', [16, 17, 18]);

    // Should evict ~50% of items (approximately 3 items)
    expect(cache.size()).toBeLessThan(4);
    expect(cache.getEvictedCount()).toBeGreaterThan(0);
  });

  it('should handle memory enforcement with high active context', async () => {
    // Mock heap stats to simulate high active context usage (95% of limit)
    jest.spyOn(RustParserBridge, 'getHeapStats').mockResolvedValue(
      JSON.stringify({
        total_allocated_bytes: 1_750_000_000,
        active_context_bytes: 1_710_000_000, // 95% of 1.8GB
        peak_allocated_bytes: 1_750_000_000,
        system_memory_limit_bytes: 1_800_000_000,
        available_system_ram_bytes: 200_000_000,
      })
    );

    const cache = new VectorLRUCache(5);

    // Add items
    await cache.set('key1', [1, 2, 3]);
    await cache.set('key2', [4, 5, 6]);
    await cache.set('key3', [7, 8, 9]);
    await cache.set('key4', [10, 11, 12]);
    await cache.set('key5', [13, 14, 15]);

    // Add a new item which should trigger aggressive eviction
    await cache.set('key6', [16, 17, 18]);

    // Should evict ~50% of items
    expect(cache.size()).toBeLessThan(4);
    expect(cache.getEvictedCount()).toBeGreaterThan(0);
  });

  it('should clear cache properly', async () => {
    const cache = new VectorLRUCache(3);

    jest.spyOn(RustParserBridge, 'getHeapStats').mockResolvedValue(
      JSON.stringify({
        total_allocated_bytes: 350_000_000,
        active_context_bytes: 250_000_000,
        peak_allocated_bytes: 400_000_000,
        system_memory_limit_bytes: 1_800_000_000,
        available_system_ram_bytes: 1_000_000_000,
      })
    );

    await cache.set('key1', [1, 2, 3]);
    await cache.set('key2', [4, 5, 6]);

    expect(cache.size()).toBe(2);

    cache.clear();

    expect(cache.size()).toBe(0);
    expect(cache.get('key1')).toBeUndefined();
  });

  it('should return correct size', async () => {
    const cache = new VectorLRUCache(3);

    jest.spyOn(RustParserBridge, 'getHeapStats').mockResolvedValue(
      JSON.stringify({
        total_allocated_bytes: 350_000_000,
        active_context_bytes: 250_000_000,
        peak_allocated_bytes: 400_000_000,
        system_memory_limit_bytes: 1_800_000_000,
        available_system_ram_bytes: 1_000_000_000,
      })
    );

    expect(cache.size()).toBe(0);

    await cache.set('key1', [1, 2, 3]);
    await cache.set('key2', [4, 5, 6]);

    expect(cache.size()).toBe(2);

    await cache.set('key3', [7, 8, 9]);
    await cache.set('key4', [10, 11, 12]);

    expect(cache.size()).toBe(3); // Should not exceed maxSize
  });

  it('should return correct evicted count', async () => {
    const cache = new VectorLRUCache(2);

    jest.spyOn(RustParserBridge, 'getHeapStats').mockResolvedValue(
      JSON.stringify({
        total_allocated_bytes: 350_000_000,
        active_context_bytes: 250_000_000,
        peak_allocated_bytes: 400_000_000,
        system_memory_limit_bytes: 1_800_000_000,
        available_system_ram_bytes: 1_000_000_000,
      })
    );

    expect(cache.getEvictedCount()).toBe(0);

    await cache.set('key1', [1, 2, 3]);
    await cache.set('key2', [4, 5, 6]);
    await cache.set('key3', [7, 8, 9]);

    expect(cache.getEvictedCount()).toBe(1); // key1 was evicted
  });

  it('should handle edge case with maxSize = 0', async () => {
    const cache = new VectorLRUCache(0);

    jest.spyOn(RustParserBridge, 'getHeapStats').mockResolvedValue(
      JSON.stringify({
        total_allocated_bytes: 350_000_000,
        active_context_bytes: 250_000_000,
        peak_allocated_bytes: 400_000_000,
        system_memory_limit_bytes: 1_800_000_000,
        available_system_ram_bytes: 1_000_000_000,
      })
    );

    await cache.set('key1', [1, 2, 3]);

    expect(cache.get('key1')).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  describe('Database Cache-Through Integration', () => {
    let db: Database.Database;
    const corpId = 'c-cache-test';
    const docId = 'd-cache-test';
    const secId = 's-cache-test';
    const blockId = 'b-cache-test';

    beforeEach(() => {
      db = new Database(':memory:');
      db.exec(INITIALIZE_DATABASE_SCHEMA);

      // Seed baseline schemas for foreign keys
      db.prepare("INSERT INTO corpora (id, name) VALUES (?, 'Test Corp');").run(corpId);
      db.prepare("INSERT INTO documents (id, corpus_id, title, sha256_hash, storage_path) VALUES (?, ?, 'Test Book', 'abc_hash', '/tmp');").run(docId, corpId);
      db.prepare("INSERT INTO sections (id, document_id, title, sort_order) VALUES (?, ?, 'Test Chapter', 1);").run(secId, docId);
      db.prepare("INSERT INTO blocks (id, section_id, document_id, content, sort_order) VALUES (?, ?, ?, 'Test paragraph', 1);").run(blockId, secId, docId);
    });

    afterEach(() => {
      db.close();
    });

    it('should save embeddings to SQLite as BLOB, and fetch on cache miss', async () => {
      const cacheWithDb = new VectorLRUCache(5, db);
      const testVec = Float32Array.from([0.5, 0.25, 0.75, 1.0]);

      // Set vector (writes to memory and DB BLOB)
      await cacheWithDb.set(blockId, testVec);

      // Query database directly to assert raw binary storage
      const dbRow = db.prepare('SELECT vector FROM vector_cache WHERE block_id = ?;').get(blockId) as any;
      expect(dbRow).toBeDefined();
      expect(dbRow.vector).toBeInstanceOf(Buffer);

      // Clear memory cache to force SQLite cache-through lookup
      cacheWithDb.clear();
      expect(cacheWithDb.size()).toBe(0);

      // Read from cache again: triggers SQLite reading and deserialization
      const retrieved = cacheWithDb.get(blockId);
      expect(retrieved).toBeDefined();
      expect(retrieved).toBeInstanceOf(Float32Array);
      expect(Array.from(retrieved!)).toEqual([0.5, 0.25, 0.75, 1.0]);
      expect(cacheWithDb.size()).toBe(1); // Saved back to memory map
    });

    it('should automatically delete cached vectors via ON DELETE CASCADE', async () => {
      const cacheWithDb = new VectorLRUCache(5, db);
      const testVec = Float32Array.from([0.5, 0.6]);

      await cacheWithDb.set(blockId, testVec);

      // Verify row exists in DB
      let dbRow = db.prepare('SELECT * FROM vector_cache WHERE block_id = ?;').get(blockId);
      expect(dbRow).toBeDefined();

      // Delete the block from relational table: triggers database cascade trigger
      db.prepare('DELETE FROM blocks WHERE id = ?;').run(blockId);

      // Verify cascading deleted vector_cache record
      dbRow = db.prepare('SELECT * FROM vector_cache WHERE block_id = ?;').get(blockId);
      expect(dbRow).toBeUndefined();
    });
  });
});
