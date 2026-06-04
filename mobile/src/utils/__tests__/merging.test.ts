import { mergeOverlappingHighlights, Highlight, computeLCS, mergeThreeWay } from '../merging';

describe('Highlight Overlap Merging Algorithm', () => {
  it('should return empty segments list if no highlights exist', () => {
    expect(mergeOverlappingHighlights([])).toEqual([]);
  });

  it('should keep distinct highlights separate if they do not overlap', () => {
    const highlights: Highlight[] = [
      { id: 'h1', startOffset: 10, endOffset: 20, colorCode: 'red' },
      { id: 'h2', startOffset: 30, endOffset: 40, colorCode: 'blue' },
    ];

    const segments = mergeOverlappingHighlights(highlights);
    expect(segments.length).toBe(2);
    expect(segments[0]).toEqual({
      startOffset: 10,
      endOffset: 20,
      highlightIds: ['h1'],
      colors: ['red'],
    });
    expect(segments[1]).toEqual({
      startOffset: 30,
      endOffset: 40,
      highlightIds: ['h2'],
      colors: ['blue'],
    });
  });

  it('should merge co-existing highlights overlapping identical ranges for social reading', () => {
    const highlights: Highlight[] = [
      { id: 'h1', startOffset: 15, endOffset: 25, colorCode: 'yellow' },
      { id: 'h2', startOffset: 15, endOffset: 25, colorCode: 'yellow' },
    ];

    const segments = mergeOverlappingHighlights(highlights);
    expect(segments.length).toBe(1);
    expect(segments[0]).toEqual({
      startOffset: 15,
      endOffset: 25,
      highlightIds: ['h1', 'h2'],
      colors: ['yellow'], // Deduplicated color codes
    });
  });

  it('should split partially overlapping annotations into continuous distinct sub-segments', () => {
    const highlights: Highlight[] = [
      { id: 'authorA', startOffset: 10, endOffset: 30, colorCode: 'red' },
      { id: 'authorB', startOffset: 20, endOffset: 40, colorCode: 'blue' },
    ];

    const segments = mergeOverlappingHighlights(highlights);
    // Overlap boundaries are [10, 20, 30, 40] -> Segments: [10-20], [20-30], [30-40]
    expect(segments.length).toBe(3);

    expect(segments[0]).toEqual({
      startOffset: 10,
      endOffset: 20,
      highlightIds: ['authorA'],
      colors: ['red'],
    });

    expect(segments[1]).toEqual({
      startOffset: 20,
      endOffset: 30,
      highlightIds: ['authorA', 'authorB'],
      colors: ['red', 'blue'],
    });

    expect(segments[2]).toEqual({
      startOffset: 30,
      endOffset: 40,
      highlightIds: ['authorB'],
      colors: ['blue'],
    });
  });
});

describe('Myers LCS Character-Level 3-Way Merge Algorithm', () => {
  describe('computeLCS', () => {
    it('should compute the correct longest common subsequence of two strings', () => {
      expect(computeLCS('abcde', 'ace')).toBe('ace');
      expect(computeLCS('fabulous', 'famous')).toBe('faous');
      expect(computeLCS('hello', 'world')).toBe('l');
      expect(computeLCS('', 'anything')).toBe('');
      expect(computeLCS('anything', '')).toBe('');
    });
  });

  describe('mergeThreeWay', () => {
    it('should cleanly merge when there are no conflicts (one side modified, other unchanged)', () => {
      const base = 'Relational SQLite triggers automate FTS5 indexing.';
      const ours = 'Relational SQLite triggers automate FTS5 indexing.';
      const theirs = 'Relational SQLite triggers automate FTS5 indexing completely.';

      const result = mergeThreeWay(base, ours, theirs);
      expect(result.hasConflict).toBe(false);
      expect(result.mergedText).toBe(theirs);
    });

    it('should cleanly merge non-overlapping edits from both sides', () => {
      const base = 'apple pie is delicious';
      const ours = 'sweet apple pie is delicious';
      const theirs = 'apple pie is delicious!';

      const result = mergeThreeWay(base, ours, theirs);
      expect(result.hasConflict).toBe(false);
      expect(result.mergedText).toBe('sweet apple pie is delicious!');
    });

    it('should cleanly handle deletions on one side', () => {
      const base = 'apple pie';
      const ours = 'aple pie'; // delete one 'p'
      const theirs = 'apple pie is good'; // insert ' is good'

      const result = mergeThreeWay(base, ours, theirs);
      expect(result.hasConflict).toBe(false);
      expect(result.mergedText).toBe('aple pie is good');
    });

    it('should identify conflicts for overlapping different edits', () => {
      const base = 'apple pie';
      const ours = 'aple pie'; // deleted one 'p'
      const theirs = 'grape pie'; // replaced apple with grape

      const result = mergeThreeWay(base, ours, theirs);
      expect(result.hasConflict).toBe(true);
      expect(result.mergedText).toContain('<<<<<<< OURS');
      expect(result.mergedText).toContain('=======');
      expect(result.mergedText).toContain('>>>>>>> THEIRS');
    });

    it('should handle empty base gracefully and treat differing additions as conflict', () => {
      const result = mergeThreeWay('', 'Hello from Alpha', 'Hello from Beta');
      expect(result.hasConflict).toBe(true);
      expect(result.mergedText).toContain('<<<<<<< OURS');
      expect(result.mergedText).toContain('Hello from Alpha');
      expect(result.mergedText).toContain('Hello from Beta');
    });

    it('should handle empty base gracefully and treat identical additions as clean', () => {
      const result = mergeThreeWay('', 'Hello identical', 'Hello identical');
      expect(result.hasConflict).toBe(false);
      expect(result.mergedText).toBe('Hello identical');
    });

    it('should safely merge concurrent overlapping modifications from distinct author profiles without corruption', () => {
      const base = 'Author highlights text content.';
      const ours = 'Author A highlights text content.';
      const theirs = 'Author B highlights text content.';
      const result = mergeThreeWay(base, ours, theirs);
      expect(result.hasConflict).toBe(true);
      expect(result.mergedText).toContain('<<<<<<< OURS');
      expect(result.mergedText).toContain('A');
      expect(result.mergedText).toContain('B');

      // Complex multi-user overlaps with multiple distinct coordinate changes
      const base2 = "This is a paragraph of standard length that multiple users are annotating concurrently.";
      const ours2 = "This is a paragraph of short length that multiple users are annotating concurrently.";
      const theirs2 = "This is a paragraph of long length that multiple users are highlighting concurrently.";
      const result2 = mergeThreeWay(base2, ours2, theirs2);
      expect(result2.hasConflict).toBe(true);
      expect(result2.mergedText).toContain("<<<<<<< OURS\nshort\n=======\nlong\n>>>>>>> THEIRS");
      expect(result2.mergedText).toContain("highlighting");

      // Highly overlapping changes
      const base3 = "The quick brown fox jumps over the lazy dog.";
      const ours3 = "The super quick brown fox jumps over the extremely lazy dog.";
      const theirs3 = "The quick red fox jumps over the very lazy dog.";
      expect(() => {
        const result3 = mergeThreeWay(base3, ours3, theirs3);
        expect(result3.mergedText).toBeDefined();
      }).not.toThrow();
    });
  });
});
