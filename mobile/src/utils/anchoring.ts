export interface AnchorMetadata {
  prefix: string;
  suffix: string;
  offset: number;
}

export interface SearchableBlock {
  id: string;
  text: string; // HTML-stripped plain text
}

export interface AnchoringResult {
  blockId: string;
  startOffset: number;
  endOffset: number;
  confidence: number; // 0.0 to 1.0
}

/**
 * High-performance W3C Web Annotation fuzzy re-anchoring engine.
 * Relies on prefix and suffix context to realign orphaned highlights onto text blocks.
 */
export function fuzzyReAnchor(
  highlightedText: string,
  context: AnchorMetadata,
  blocks: SearchableBlock[]
): AnchoringResult | null {
  if (blocks.length === 0 || !highlightedText) return null;

  let bestMatch: AnchoringResult | null = null;
  let highestScore = -1;

  for (const block of blocks) {
    const text = block.text;

    // 1. Check for exact substring match first
    let idx = text.indexOf(highlightedText);
    while (idx !== -1) {
      let score = 0.5; // Base confidence score for exact match

      // Extract surrounding context within the block to compare with prefix/suffix
      const blockPrefix = text.substring(Math.max(0, idx - context.prefix.length), idx);
      const blockSuffix = text.substring(idx + highlightedText.length, idx + highlightedText.length + context.suffix.length);

      // Boost score based on prefix context matches
      if (context.prefix && blockPrefix.includes(context.prefix.substring(context.prefix.length - 10))) {
        score += 0.25;
      }
      // Boost score based on suffix context matches
      if (context.suffix && blockSuffix.includes(context.suffix.substring(0, 10))) {
        score += 0.25;
      }

      if (score > highestScore) {
        highestScore = score;
        bestMatch = {
          blockId: block.id,
          startOffset: idx,
          endOffset: idx + highlightedText.length,
          confidence: Math.min(1.0, score),
        };
      }

      idx = text.indexOf(highlightedText, idx + 1);
    }
  }

  // If no exact match of highlight string, fall back to prefix match
  if (!bestMatch) {
    for (const block of blocks) {
      const text = block.text;
      // Search for prefix + highlightedText bounds or similar anchor clues
      if (context.prefix && text.includes(context.prefix)) {
        const pIdx = text.indexOf(context.prefix);
        const start = pIdx + context.prefix.length;
        bestMatch = {
          blockId: block.id,
          startOffset: start,
          endOffset: start + highlightedText.length,
          confidence: 0.4,
        };
        break;
      }
    }
  }

  return bestMatch;
}
