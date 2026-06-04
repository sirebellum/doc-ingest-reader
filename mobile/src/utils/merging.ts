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
  boundaries.add(0); // Ensure 0 is included if needed
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

/**
 * Finds the Longest Common Subsequence (LCS) of two string arrays.
 */
export function computeLineLCS(lines1: string[], lines2: string[]): string[] {
  const m = lines1.length;
  const n = lines2.length;
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (lines1[i - 1] === lines2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const lcs: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (lines1[i - 1] === lines2[j - 1]) {
      lcs.unshift(lines1[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

/**
 * Finds the LCS of two strings at character level.
 */
export function computeLCS(s1: string, s2: string): string {
  if (!s1 || !s2) return "";
  const chars1 = s1.split("");
  const chars2 = s2.split("");
  return computeLineLCS(chars1, chars2).join("");
}

interface TokenAlignment {
  insertions: string[][];
  deletions: boolean[];
}

/**
 * Aligns tokens with their LCS to identify inserted and deleted hunks.
 */
function alignTokensWithLCS(baseTokens: string[], otherTokens: string[], lcs: string[]): TokenAlignment {
  const matchedBase = new Set<number>();
  const matchedOther = new Set<number>();
  const otherMatchMap: number[] = Array(otherTokens.length).fill(-1);

  let b = 0, o = 0;
  for (let i = 0; i < lcs.length; i++) {
    const token = lcs[i];
    while (b < baseTokens.length && baseTokens[b] !== token) b++;
    while (o < otherTokens.length && otherTokens[o] !== token) o++;
    if (b < baseTokens.length && o < otherTokens.length) {
      matchedBase.add(b);
      matchedOther.add(o);
      otherMatchMap[o] = b;
      b++;
      o++;
    }
  }

  const insertions: string[][] = Array(baseTokens.length + 1)
    .fill(null)
    .map(() => []);
  let currentBasePos = 0;
  for (let o = 0; o < otherTokens.length; o++) {
    if (matchedOther.has(o)) {
      currentBasePos = otherMatchMap[o] + 1;
    } else {
      insertions[currentBasePos].push(otherTokens[o]);
    }
  }

  const deletions: boolean[] = Array(baseTokens.length).fill(false);
  for (let b = 0; b < baseTokens.length; b++) {
    deletions[b] = !matchedBase.has(b);
  }

  return { insertions, deletions };
}

/**
 * Performs a hybrid token-based 3-way merge on three texts.
 * Splits by newlines for multi-line notes, and by spaces for single-line notes.
 * If conflicts occur, standard git-style markers are inserted inline.
 */
export function mergeThreeWay(
  base: string,
  ours: string,
  theirs: string
): { mergedText: string; hasConflict: boolean } {
  // 1. Handle identity cases
  if (ours === theirs) {
    return { mergedText: ours, hasConflict: false };
  }
  if (ours === base) {
    return { mergedText: theirs, hasConflict: false };
  }
  if (theirs === base) {
    return { mergedText: ours, hasConflict: false };
  }

  // 2. Handle empty bases
  if (!base) {
    return {
      mergedText: `<<<<<<< OURS\n${ours}\n=======\n${theirs}\n>>>>>>> THEIRS`,
      hasConflict: true,
    };
  }

  // 3. Select tokenization level (lines or words)
  const separator = base.includes("\n") || ours.includes("\n") || theirs.includes("\n") ? "\n" : " ";
  const baseTokens = base.split(separator);
  const oursTokens = ours.split(separator);
  const theirsTokens = theirs.split(separator);

  const lcsOurs = computeLineLCS(baseTokens, oursTokens);
  const lcsTheirs = computeLineLCS(baseTokens, theirsTokens);

  const alignO = alignTokensWithLCS(baseTokens, oursTokens, lcsOurs);
  const alignT = alignTokensWithLCS(baseTokens, theirsTokens, lcsTheirs);

  const mergedTokens: string[] = [];
  let hasConflict = false;

  for (let p = 0; p <= baseTokens.length; p++) {
    const insO = alignO.insertions[p];
    const insT = alignT.insertions[p];

    const insOStr = insO.join(separator);
    const insTStr = insT.join(separator);

    if (insOStr === insTStr) {
      if (insO.length > 0) mergedTokens.push(...insO);
    } else if (insO.length === 0) {
      if (insT.length > 0) mergedTokens.push(...insT);
    } else if (insT.length === 0) {
      if (insO.length > 0) mergedTokens.push(...insO);
    } else {
      hasConflict = true;
      mergedTokens.push(`<<<<<<< OURS\n${insOStr}\n=======\n${insTStr}\n>>>>>>> THEIRS`);
    }

    if (p < baseTokens.length) {
      const keptO = !alignO.deletions[p];
      const keptT = !alignT.deletions[p];

      if (keptO && keptT) {
        mergedTokens.push(baseTokens[p]);
      } else if (!keptO && !keptT) {
        // Both deleted
      } else {
        // One deleted, one kept. Deletion wins.
      }
    }
  }

  return {
    mergedText: mergedTokens.join(separator),
    hasConflict,
  };
}
