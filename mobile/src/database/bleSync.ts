import { compileSyncDelta, applySyncDelta, SyncResult } from './p2pSync';
import { compressLZW, decompressLZW } from '../utils/packer';
import WirelessSyncBridge from '../native/WirelessSyncBridge';

function computeChecksum(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

export class BLESyncCommunicator {
  private transactionState: Map<string, { chunks: Map<number, string>; totalChunks: number }> = new Map();

  /**
   * Sends a delta over BLE by partitioning it into MTU-sized chunks.
   * @param dbInstance The database instance to compile the delta from.
   * @param documentId The document ID to sync.
   * @param sinceTimestamp The timestamp to sync from.
   * @param deviceId The device ID to sync with.
   * @returns An array of chunk strings.
   */
  async sendDelta(dbInstance: any, documentId: string, sinceTimestamp: string, deviceId: string): Promise<string[]> {
    // Compile the sync delta (synchronous in our p2pSync module)
    const delta = compileSyncDelta(dbInstance, documentId, sinceTimestamp, deviceId);
    
    // Serialize the delta to JSON
    const deltaJson = JSON.stringify(delta);
    
    // Compress the JSON string
    const compressed = compressLZW(deltaJson);
    
    // MTU size is 512 bytes
    const MTU_SIZE = 512;
    
    // Split into chunks
    const chunks: string[] = [];
    const totalChunks = Math.ceil(compressed.length / MTU_SIZE);
    const txId = `${documentId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * MTU_SIZE;
      const end = Math.min(start + MTU_SIZE, compressed.length);
      const payload = compressed.substring(start, end);
      
      const chunkIndex = i;
      const checksum = computeChecksum(payload);
      
      const chunkStr = `${txId}|${chunkIndex}|${totalChunks}|${checksum}|${payload}`;
      chunks.push(chunkStr);
    }
    
    return chunks;
  }

  /**
   * Receives a chunk and assembles it into a complete delta.
   * @param chunkStr The chunk string to process.
   * @returns Progress and complete delta JSON if available.
   */
  receiveChunk(chunkStr: string): { progress: number; completeDeltaJson: string | null } {
    // Parse chunk string
    const parts = chunkStr.split('|');
    if (parts.length !== 5) {
      throw new Error('Invalid chunk format');
    }

    const txId = parts[0];
    const chunkIndex = parseInt(parts[1], 10);
    const totalChunks = parseInt(parts[2], 10);
    const checksum = parts[3];
    const payload = parts[4];

    // Validate checksum
    const computedChecksum = computeChecksum(payload);
    if (checksum !== computedChecksum) {
      throw new Error('Checksum verification failed');
    }

    // Initialize transaction state if needed
    if (!this.transactionState.has(txId)) {
      this.transactionState.set(txId, {
        chunks: new Map(),
        totalChunks
      });
    }

    const txState = this.transactionState.get(txId)!;
    txState.chunks.set(chunkIndex, payload);

    // Check if all chunks have been received
    if (txState.chunks.size === txState.totalChunks) {
      // Reassemble chunks in order
      const sortedChunks = Array.from(txState.chunks.entries())
        .sort((a, b) => a[0] - b[0])
        .map(entry => entry[1])
        .join('');

      // Decompress
      const decompressed = decompressLZW(sortedChunks);
      
      // Clean up transaction state
      this.transactionState.delete(txId);

      return {
        progress: 100,
        completeDeltaJson: decompressed
      };
    }

    // Calculate progress
    const progress = Math.round((txState.chunks.size / txState.totalChunks) * 100);
    
    return {
      progress,
      completeDeltaJson: null
    };
  }

  /**
   * Applies the received delta to the database.
   * @param dbInstance The database instance to apply the delta to.
   * @param completeDeltaJson The complete delta JSON string.
   * @returns The sync result.
   */
  applyReceivedDelta(dbInstance: any, completeDeltaJson: string): SyncResult {
    const delta = JSON.parse(completeDeltaJson);
    return applySyncDelta(dbInstance, delta);
  }

  /**
   * Transmits compiled BLE MTU packets physically via WirelessSyncBridge.
   */
  async sendDeltaPhysically(
    dbInstance: any,
    documentId: string,
    sinceTimestamp: string,
    deviceId: string,
    onProgress?: (progress: number) => void
  ): Promise<boolean> {
    const chunks = await this.sendDelta(dbInstance, documentId, sinceTimestamp, deviceId);
    if (chunks.length === 0) return true;

    for (let i = 0; i < chunks.length; i++) {
      const success = await WirelessSyncBridge.sendBleChunk(deviceId, chunks[i]);
      if (!success) {
        throw new Error(`Failed to transmit packet ${i + 1}/${chunks.length} over physical BLE transceiver`);
      }
      if (onProgress) {
        onProgress(Math.round(((i + 1) / chunks.length) * 100));
      }
    }
    return true;
  }

  /**
   * Subscribes to the physical WirelessSyncBridge chunk receiver and reassembles incoming packets.
   */
  setupPhysicalListener(
    dbInstance: any,
    onProgress: (progress: number) => void,
    onComplete: (syncRes: SyncResult) => void,
    onError: (err: Error) => void
  ): { remove: () => void } {
    const subscription = WirelessSyncBridge.onBleChunkReceived((event) => {
      try {
        const { progress, completeDeltaJson } = this.receiveChunk(event.chunk);
        onProgress(progress);
        if (completeDeltaJson) {
          const syncRes = this.applyReceivedDelta(dbInstance, completeDeltaJson);
          onComplete(syncRes);
        }
      } catch (err: any) {
        onError(err);
      }
    });

    return {
      remove: () => subscription.remove()
    };
  }
}
