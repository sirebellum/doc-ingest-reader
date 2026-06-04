import { RustParserBridge } from '../native/RustParserBridge';
import { getDatabaseAdapter } from './backup';

interface HeapStats {
  total_allocated_bytes: number;
  active_context_bytes: number;
  peak_allocated_bytes: number;
  system_memory_limit_bytes: number;
  available_system_ram_bytes: number;
}

export class VectorLRUCache {
  private cache: Map<string, Float32Array>;
  private maxSize: number;
  private evictedCount: number = 0;
  private dbInstance: any;

  constructor(maxSize: number = 5000, dbInstance?: any) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.dbInstance = dbInstance;
  }

  private toFloat32Array(bytes: any): Float32Array {
    const arrayBuffer = bytes.buffer;
    const byteOffset = bytes.byteOffset || 0;
    const byteLength = bytes.byteLength || bytes.length;
    
    // Safety check for alignment
    if (byteOffset % 4 === 0) {
      return new Float32Array(arrayBuffer, byteOffset, byteLength / 4);
    } else {
      const slice = arrayBuffer.slice(byteOffset, byteOffset + byteLength);
      return new Float32Array(slice);
    }
  }

  get(blockId: string): Float32Array | undefined {
    const value = this.cache.get(blockId);
    if (value !== undefined) {
      // Move to end to mark as most recently used
      this.cache.delete(blockId);
      this.cache.set(blockId, value);
      return value;
    }

    if (this.dbInstance) {
      try {
        const db = getDatabaseAdapter(this.dbInstance);
        const row = db.get<{ vector: Uint8Array | Buffer }>(
          'SELECT vector FROM vector_cache WHERE block_id = ?;',
          [blockId]
        );
        if (row && row.vector) {
          const vector = this.toFloat32Array(row.vector);
          this.cache.set(blockId, vector);
          return vector;
        }
      } catch (error) {
        console.warn(`[VectorLRUCache] Error reading from SQLite for ${blockId}:`, error);
      }
    }

    return undefined;
  }

  async set(blockId: string, vector: number[] | Float32Array): Promise<void> {
    const floatVec = vector instanceof Float32Array ? vector : new Float32Array(vector);

    // Remove existing entry if present
    this.cache.delete(blockId);
    this.cache.set(blockId, floatVec);

    if (this.dbInstance) {
      try {
        const db = getDatabaseAdapter(this.dbInstance);
        const byteView = new Uint8Array(floatVec.buffer, floatVec.byteOffset, floatVec.byteLength);
        let bindValue: any = byteView;
        if (typeof Buffer !== 'undefined') {
          bindValue = Buffer.from(floatVec.buffer, floatVec.byteOffset, floatVec.byteLength);
        }
        db.run(
          'INSERT OR REPLACE INTO vector_cache (block_id, vector) VALUES (?, ?);',
          [blockId, bindValue]
        );
      } catch (error) {
        console.warn(`[VectorLRUCache] Error writing to SQLite for ${blockId}:`, error);
      }
    }

    // Check memory and evict if needed
    await this.checkMemoryAndEvict();

    // If we exceed maxSize, evict oldest entries
    if (this.cache.size > this.maxSize) {
      const entriesToEvict = this.cache.size - this.maxSize;
      const iterator = this.cache.keys();
      for (let i = 0; i < entriesToEvict; i++) {
        const nextKey = iterator.next().value;
        if (nextKey !== undefined) {
          this.cache.delete(nextKey);
          this.evictedCount++;
        }
      }
    }
  }

  clear(): void {
    this.cache.clear();
    this.evictedCount = 0;
  }

  size(): number {
    return this.cache.size;
  }

  getEvictedCount(): number {
    return this.evictedCount;
  }

  private async checkMemoryAndEvict(): Promise<void> {
    try {
      const statsString = await RustParserBridge.getHeapStats();
      if (!statsString) return;

      const heapStats: HeapStats = JSON.parse(statsString);

      // Check for aggressive eviction conditions
      if (
        heapStats.available_system_ram_bytes < 150_000_000 || 
        heapStats.active_context_bytes > 0.9 * heapStats.system_memory_limit_bytes
      ) {
        // Aggressively evict oldest 50% of entries to prevent system OOM terminations
        const entriesToEvict = Math.max(1, Math.floor(this.cache.size / 2));
        const iterator = this.cache.keys();
        for (let i = 0; i < entriesToEvict; i++) {
          const nextKey = iterator.next().value;
          if (nextKey !== undefined) {
            this.cache.delete(nextKey);
            this.evictedCount++;
          }
        }
      }
    } catch (error) {
      // If we can't get heap stats or parsing fails, proceed normally
      console.warn('Failed to get heap stats for memory check:', error);
    }
  }
}
export default VectorLRUCache;
