import {
  exportDocumentNotesBackup,
  importDocumentNotesBackup,
  BackupPayload,
  ImportResult
} from '../backup';

describe('backup', () => {
  let originalDocSync: any;

  beforeEach(() => {
    originalDocSync = global.doc_sync;
    global.doc_sync = {
      exportDocumentNotesBackupAsync: jest.fn(),
      importDocumentNotesBackupAsync: jest.fn(),
    } as any;
  });

  afterEach(() => {
    global.doc_sync = originalDocSync;
    jest.resetAllMocks();
  });

  describe('exportDocumentNotesBackup', () => {
    it('should call global.doc_sync.exportDocumentNotesBackupAsync and parse the result', async () => {
      const mockPayload: BackupPayload = {
        schema_version: "1.0",
        document: {
          title: "Test Document",
          author: "Author",
          source_type: "pdf",
          sha256_hash: "hash",
        },
        annotations: []
      };

      (global.doc_sync!.exportDocumentNotesBackupAsync as jest.Mock).mockResolvedValue(new TextEncoder().encode(JSON.stringify(mockPayload)));

      const documentId = "doc123";
      const privateKey = "private-key";
      const publicKey = "public-key";

      const result = await exportDocumentNotesBackup(documentId, privateKey, publicKey);

      expect(global.doc_sync!.exportDocumentNotesBackupAsync).toHaveBeenCalledWith(documentId, privateKey, publicKey);
      expect(result).toEqual(mockPayload);
    });

    it('should throw an error if global.doc_sync is not defined', async () => {
      global.doc_sync = undefined;
      await expect(exportDocumentNotesBackup("doc123")).rejects.toThrow("JSI bridge for doc_sync not found");
    });
    
    it('should throw an error if exportDocumentNotesBackupAsync is not a function', async () => {
      global.doc_sync = {} as any;
      await expect(exportDocumentNotesBackup("doc123")).rejects.toThrow("JSI bridge for doc_sync not found");
    });
  });

  describe('importDocumentNotesBackup', () => {
    it('should call global.doc_sync.importDocumentNotesBackupAsync and parse the result', async () => {
      const mockPayload: BackupPayload = {
        schema_version: "1.0",
        document: {
          title: "Test Document",
          author: "Author",
          source_type: "pdf",
          sha256_hash: "hash",
        },
        annotations: []
      };

      const mockResult: ImportResult = {
        status: "success",
        importedCount: 1,
        skippedCount: 0,
        fuzzyReAnchorCount: 0,
        orphanedCount: 0
      };

      (global.doc_sync!.importDocumentNotesBackupAsync as jest.Mock).mockResolvedValue(new TextEncoder().encode(JSON.stringify(mockResult)));

      const result = await importDocumentNotesBackup(mockPayload);

      expect(global.doc_sync!.importDocumentNotesBackupAsync).toHaveBeenCalledWith(new TextEncoder().encode(JSON.stringify(mockPayload)));
      expect(result).toEqual(mockResult);
    });

    it('should throw an error if global.doc_sync is not defined', async () => {
      global.doc_sync = undefined;
      await expect(importDocumentNotesBackup({} as any)).rejects.toThrow("JSI bridge for doc_sync not found");
    });
    
    it('should throw an error if importDocumentNotesBackupAsync is not a function', async () => {
      global.doc_sync = {} as any;
      await expect(importDocumentNotesBackup({} as any)).rejects.toThrow("JSI bridge for doc_sync not found");
    });
  });
});
