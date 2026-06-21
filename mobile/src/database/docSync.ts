export interface SyncResult {
  status: 'success' | 'document_not_found';
  appliedAnnotationsCount: number;
  skippedAnnotationsCount: number;
  fuzzyReAnchorCount: number;
  orphanedCount: number;
  appliedTagsCount: number;
  appliedBlockTagsCount: number;
}

export class BLESyncCommunicator {
  constructor() {}
  setupPhysicalListener(db: any, onProgress: (p: number) => void, onComplete: (r: SyncResult) => void, onError: (e: Error) => void) {
    return { remove: () => {} };
  }
  async sendDeltaPhysically(db: any, docId: string, since: string, device: string, onProgress: (p: number) => void) {
    return true;
  }
}

export class P2PSyncService {
  constructor(deviceId: string) {}
  async startDiscovery(deviceId: string, onDeviceFound: (id: string) => void) {}
  async connectToPeer(peerId: string) { return true; }
  async handshakeAndSync(db: any, docId: string, ts: string) { return {} as any; }
}
