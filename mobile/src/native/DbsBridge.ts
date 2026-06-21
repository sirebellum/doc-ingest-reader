import type { Corpus } from "../../../rust_core/contracts/bindings/Corpus";
import type { Document } from "../../../rust_core/contracts/bindings/Document";
import type { Section } from "../../../rust_core/contracts/bindings/Section";
import type { Block } from "../../../rust_core/contracts/bindings/Block";
import type { Annotation } from "../../../rust_core/contracts/bindings/Annotation";

// Declare global JSI interface for TypeScript
declare global {
  var dbs: {
    getCorporaAsync(): Promise<ArrayBuffer>;
    getDocumentsAsync(): Promise<ArrayBuffer>;
    getSectionsForDocumentAsync(documentId: string): Promise<ArrayBuffer>;
    getBlocksForSectionAsync(sectionId: string): Promise<ArrayBuffer>;
    getAnnotationsForBlocksAsync(blockIds: string[]): Promise<ArrayBuffer>;
    saveAnnotationAsync(annotationJson: ArrayBuffer): Promise<void>;
    deleteAnnotationAsync(annotationId: string): Promise<void>;
    getOrCacheLayoutHeightAsync(blockId: string, estimatedHeight: number): Promise<number>;
    evictLayoutHeightCacheAsync(): Promise<void>;
    clearDatabaseAsync(): Promise<void>;
    getTagsWithAuthorsAsync(): Promise<ArrayBuffer>;
    getTagCooccurrencesAsync(): Promise<ArrayBuffer>;
    searchBlocksAsync(query: string): Promise<ArrayBuffer>;
    getFirstDocumentIdAsync(): Promise<ArrayBuffer>;
    getConflictingAnnotationsAsync(): Promise<ArrayBuffer>;
    resolveAnnotationConflictAsync(annotationId: string, resolvedText: string): Promise<void>;
    getVectorAsync(blockId: string): Promise<ArrayBuffer>;
    setVectorAsync(blockId: string, vectorData: ArrayBuffer): Promise<void>;
  } | undefined;
}

export const DbsBridge = {
  async getCorporaAsync(): Promise<Corpus[]> {
    if (global.dbs && typeof global.dbs.getCorporaAsync === 'function') {
      const result = await global.dbs.getCorporaAsync();
      return JSON.parse(new TextDecoder().decode(new Uint8Array(result)));
    }
    return [];
  },

  async getDocumentsAsync(): Promise<Document[]> {
    if (global.dbs && typeof global.dbs.getDocumentsAsync === 'function') {
      const result = await global.dbs.getDocumentsAsync();
      return JSON.parse(new TextDecoder().decode(new Uint8Array(result)));
    }
    return [];
  },

  async getSectionsForDocumentAsync(documentId: string): Promise<Section[]> {
    if (global.dbs && typeof global.dbs.getSectionsForDocumentAsync === 'function') {
      const result = await global.dbs.getSectionsForDocumentAsync(documentId);
      return JSON.parse(new TextDecoder().decode(new Uint8Array(result)));
    }
    return [];
  },

  async getBlocksForSectionAsync(sectionId: string): Promise<Block[]> {
    if (global.dbs && typeof global.dbs.getBlocksForSectionAsync === 'function') {
      const result = await global.dbs.getBlocksForSectionAsync(sectionId);
      return JSON.parse(new TextDecoder().decode(new Uint8Array(result)));
    }
    return [];
  },

  async getAnnotationsForBlocksAsync(blockIds: string[]): Promise<Annotation[]> {
    if (global.dbs && typeof global.dbs.getAnnotationsForBlocksAsync === 'function') {
      const result = await global.dbs.getAnnotationsForBlocksAsync(blockIds);
      return JSON.parse(new TextDecoder().decode(new Uint8Array(result)));
    }
    return [];
  },

  async saveAnnotationAsync(annotation: Annotation): Promise<void> {
    if (global.dbs && typeof global.dbs.saveAnnotationAsync === 'function') {
      const data = new TextEncoder().encode(JSON.stringify(annotation));
      await global.dbs.saveAnnotationAsync(data.buffer);
    }
  },

  async deleteAnnotationAsync(annotationId: string): Promise<void> {
    if (global.dbs && typeof global.dbs.deleteAnnotationAsync === 'function') {
      await global.dbs.deleteAnnotationAsync(annotationId);
    }
  },

  async getOrCacheLayoutHeightAsync(blockId: string, estimatedHeight: number): Promise<number> {
    if (global.dbs && typeof global.dbs.getOrCacheLayoutHeightAsync === 'function') {
      return await global.dbs.getOrCacheLayoutHeightAsync(blockId, estimatedHeight);
    }
    return estimatedHeight;
  },

  async evictLayoutHeightCacheAsync(): Promise<void> {
    if (global.dbs && typeof global.dbs.evictLayoutHeightCacheAsync === 'function') {
      await global.dbs.evictLayoutHeightCacheAsync();
    }
  },

  async clearDatabaseAsync(): Promise<void> {
    if (global.dbs && typeof global.dbs.clearDatabaseAsync === 'function') {
      await global.dbs.clearDatabaseAsync();
    }
  },

  async getTagsWithAuthorsAsync(): Promise<Array<{ id: string; name: string; source: string; author_ids: string | null }>> {
    if (global.dbs && typeof global.dbs.getTagsWithAuthorsAsync === 'function') {
      const result = await global.dbs.getTagsWithAuthorsAsync();
      return JSON.parse(new TextDecoder().decode(new Uint8Array(result)));
    }
    return [];
  },

  async getTagCooccurrencesAsync(): Promise<Array<{ source: string; target: string; weight: number }>> {
    if (global.dbs && typeof global.dbs.getTagCooccurrencesAsync === 'function') {
      const result = await global.dbs.getTagCooccurrencesAsync();
      return JSON.parse(new TextDecoder().decode(new Uint8Array(result)));
    }
    return [];
  },

  async searchBlocksAsync(query: string): Promise<Array<{ id: string; content: string; doc_title: string }>> {
    if (global.dbs && typeof global.dbs.searchBlocksAsync === 'function') {
      const result = await global.dbs.searchBlocksAsync(query);
      return JSON.parse(new TextDecoder().decode(new Uint8Array(result)));
    }
    return [];
  },

  async getFirstDocumentIdAsync(): Promise<{ id: string } | null> {
    if (global.dbs && typeof global.dbs.getFirstDocumentIdAsync === 'function') {
      const result = await global.dbs.getFirstDocumentIdAsync();
      return result ? JSON.parse(new TextDecoder().decode(new Uint8Array(result))) : null;
    }
    return null;
  },

  async getConflictingAnnotationsAsync(): Promise<Array<{ id: string; note_body: string }>> {
    if (global.dbs && typeof global.dbs.getConflictingAnnotationsAsync === 'function') {
      const result = await global.dbs.getConflictingAnnotationsAsync();
      return JSON.parse(new TextDecoder().decode(new Uint8Array(result)));
    }
    return [];
  },

  async resolveAnnotationConflictAsync(annotationId: string, resolvedText: string): Promise<void> {
    if (global.dbs && typeof global.dbs.resolveAnnotationConflictAsync === 'function') {
      await global.dbs.resolveAnnotationConflictAsync(annotationId, resolvedText);
    }
  },

  async getVectorAsync(blockId: string): Promise<Uint8Array | undefined> {
    if (global.dbs && typeof global.dbs.getVectorAsync === 'function') {
      const result = await global.dbs.getVectorAsync(blockId);
      // Wrap the returned ArrayBuffer in a Uint8Array
      return result ? new Uint8Array(result) : undefined;
    }
    return undefined;
  },

  async setVectorAsync(blockId: string, vector: Uint8Array): Promise<void> {
    if (global.dbs && typeof global.dbs.setVectorAsync === 'function') {
      await global.dbs.setVectorAsync(blockId, vector.buffer as ArrayBuffer);
    }
  }
};
export const setupDatabase = async () => {};
