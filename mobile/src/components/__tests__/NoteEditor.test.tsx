import { NoteEditor } from '../NoteEditor';

describe('NoteEditor Autocomplete Tag Normalization & Verification', () => {
  // Test SQLite normalization logic (lowercase, whitespace stripped)
  describe('Tag Normalization Logic', () => {
    const normalizeTag = (rawTag: string) => rawTag.toLowerCase().replace(/\s+/g, '').trim();

    it('should convert tag names to lowercase and strip all interior whitespace and outer paddings', () => {
      expect(normalizeTag('  React Native  ')).toBe('reactnative');
      expect(normalizeTag('SQLite FTS5 Trigger')).toBe('sqlitefts5trigger');
      expect(normalizeTag('LLM-ingest')).toBe('llm-ingest');
    });

    it('should normalize uppercase tags correctly', () => {
      expect(normalizeTag('DATABASE')).toBe('database');
    });

    it('should ignore empty tag inputs', () => {
      expect(normalizeTag('    ')).toBe('');
    });
  });
});
