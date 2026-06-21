import { ENABLE_CORE_DEBUG_LOGS, logDebug } from '../utils/logger';

export interface ExportedAnnotation {
  id: string;
  annotation_type: string;
  color_code: string;
  highlighted_text: string | null;
  note_body: string | null;
  anchor_metadata: string | null;
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

declare global {
  var doc_sync: {
    exportDocumentNotesBackupAsync(documentId: string, privateKeyPem?: string, publicKeyPem?: string): Promise<Uint8Array>;
    importDocumentNotesBackupAsync(payloadBytes: Uint8Array): Promise<Uint8Array>;
  } | undefined;
}

export async function exportDocumentNotesBackup(
  documentId: string,
  privateKeyPem?: string,
  publicKeyPem?: string
): Promise<BackupPayload> {
  if (global.doc_sync && typeof global.doc_sync.exportDocumentNotesBackupAsync === 'function') {
    const resultBytes = await global.doc_sync.exportDocumentNotesBackupAsync(documentId, privateKeyPem, publicKeyPem);
    return JSON.parse(new TextDecoder().decode(resultBytes)) as BackupPayload;
  }
  throw new Error("JSI bridge for doc_sync not found");
}

export async function importDocumentNotesBackup(
  payload: BackupPayload
): Promise<ImportResult> {
  if (global.doc_sync && typeof global.doc_sync.importDocumentNotesBackupAsync === 'function') {
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    const resultBytes = await global.doc_sync.importDocumentNotesBackupAsync(payloadBytes);
    return JSON.parse(new TextDecoder().decode(resultBytes)) as ImportResult;
  }
  throw new Error("JSI bridge for doc_sync not found");
}
