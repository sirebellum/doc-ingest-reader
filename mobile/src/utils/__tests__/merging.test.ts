import { mergeOverlappingHighlights, Highlight } from '../merging';

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
