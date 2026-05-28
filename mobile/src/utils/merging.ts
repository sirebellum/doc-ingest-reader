export interface Highlight {
  id: string;
  startOffset: number; // 0-indexed character offset relative to block text
  endOffset: number;
  colorCode: string;
  noteBody?: string;
}

export interface VisualSegment {
  startOffset: number;
  endOffset: number;
  highlightIds: string[];
  colors: string[];
}

/**
 * High-performance highlight range merging algorithm.
 * Groups overlapping character spans so the React Native renderer can render a clean layout
 * while preserving multi-author annotations and bookmarks (social reading).
 */
export function mergeOverlappingHighlights(highlights: Highlight[]): VisualSegment[] {
  if (highlights.length === 0) return [];

  // 1. Gather all transition boundary offsets
  const boundaries = new Set<number>();
  highlights.forEach((h) => {
    boundaries.add(h.startOffset);
    boundaries.add(h.endOffset);
  });

  const sortedPoints = Array.from(boundaries).sort((a, b) => a - b);
  const segments: VisualSegment[] = [];

  // 2. Build non-overlapping visual intervals between sorted boundary points
  for (let i = 0; i < sortedPoints.length - 1; i++) {
    const start = sortedPoints[i];
    const end = sortedPoints[i + 1];

    // Find all highlights overlapping this specific sub-interval
    const activeHighlights = highlights.filter(
      (h) => h.startOffset <= start && h.endOffset >= end
    );

    if (activeHighlights.length > 0) {
      segments.push({
        startOffset: start,
        endOffset: end,
        highlightIds: activeHighlights.map((h) => h.id),
        colors: Array.from(new Set(activeHighlights.map((h) => h.colorCode))),
      });
    }
  }

  return segments;
}
