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
 * Relies on prefix, suffix, and offset context to realign orphaned highlights onto text blocks.
 */
export function fuzzyReAnchor(
  highlightedText: string,
  context: AnchorMetadata,
  blocks: SearchableBlock[]
): AnchoringResult | null {
  if (blocks.length === 0 || !highlightedText) return null;

  let bestMatch: AnchoringResult | null = null;
  let highestScore = -1;

  const targetText = highlightedText.trim();
  const targetLower = targetText.toLowerCase();

  for (const block of blocks) {
    const text = block.text;

    // --- 1. Case-Sensitive Exact Match Search ---
    let idx = text.indexOf(targetText);
    while (idx !== -1) {
      let score = 0.5; // Base confidence score for exact match

      // Extract surrounding context within the block to compare with prefix/suffix
      const blockPrefix = text.substring(Math.max(0, idx - context.prefix.length), idx);
      const blockSuffix = text.substring(idx + targetText.length, idx + targetText.length + context.suffix.length);

      // Boost score based on prefix context matches
      if (context.prefix) {
        const cleanPrefix = context.prefix.trim();
        if (cleanPrefix && (blockPrefix.includes(cleanPrefix.slice(-10)) || cleanPrefix.includes(blockPrefix.slice(-10)))) {
          score += 0.25;
        }
      }
      // Boost score based on suffix context matches
      if (context.suffix) {
        const cleanSuffix = context.suffix.trim();
        if (cleanSuffix && (blockSuffix.includes(cleanSuffix.slice(0, 10)) || cleanSuffix.includes(blockSuffix.slice(0, 10)))) {
          score += 0.25;
        }
      }

      // Proximity penalty based on offset distance (only when offset > 0)
      if (context.offset && context.offset > 0) {
        const distance = Math.abs(idx - context.offset);
        const proximityPenalty = Math.min(0.15, distance / 20000);
        score -= proximityPenalty;
      }

      if (score > highestScore) {
        highestScore = score;
        bestMatch = {
          blockId: block.id,
          startOffset: idx,
          endOffset: idx + targetText.length,
          confidence: Math.max(0.1, Math.min(1.0, score)),
        };
      }

      idx = text.indexOf(targetText, idx + 1);
    }

    // --- 2. Case-Insensitive Exact Match Search (Fallback) ---
    if (highestScore < 0.5) {
      let cIdx = text.toLowerCase().indexOf(targetLower);
      while (cIdx !== -1) {
        let score = 0.4; // Slightly lower base score for case-insensitive

        const blockPrefix = text.substring(Math.max(0, cIdx - context.prefix.length), cIdx);
        const blockSuffix = text.substring(cIdx + targetText.length, cIdx + targetText.length + context.suffix.length);

        if (context.prefix) {
          const cleanPrefix = context.prefix.trim().toLowerCase();
          if (cleanPrefix && (blockPrefix.toLowerCase().includes(cleanPrefix.slice(-10)) || cleanPrefix.includes(blockPrefix.toLowerCase().slice(-10)))) {
            score += 0.2;
          }
        }
        if (context.suffix) {
          const cleanSuffix = context.suffix.trim().toLowerCase();
          if (cleanSuffix && (blockSuffix.toLowerCase().includes(cleanSuffix.slice(0, 10)) || cleanSuffix.includes(blockSuffix.toLowerCase().slice(0, 10)))) {
            score += 0.2;
          }
        }

        if (context.offset && context.offset > 0) {
          const distance = Math.abs(cIdx - context.offset);
          const proximityPenalty = Math.min(0.15, distance / 20000);
          score -= proximityPenalty;
        }

        if (score > highestScore) {
          highestScore = score;
          bestMatch = {
            blockId: block.id,
            startOffset: cIdx,
            endOffset: cIdx + targetText.length,
            confidence: Math.max(0.1, Math.min(1.0, score)),
          };
        }

        cIdx = text.toLowerCase().indexOf(targetLower, cIdx + 1);
      }
    }
  }

  // --- 3. Prefix/Suffix Context Word-Match Alignment (Typo / Edition Mismatch Fallback) ---
  if (!bestMatch || highestScore < 0.4) {
    for (const block of blocks) {
      const text = block.text;

      if (context.prefix) {
        const cleanPrefix = context.prefix.trim();
        if (cleanPrefix && text.includes(cleanPrefix)) {
          const pIdx = text.indexOf(cleanPrefix);
          const start = pIdx + cleanPrefix.length;
          
          let score = 0.4; // Strict fallback score

          if (score > highestScore) {
            highestScore = score;
            bestMatch = {
              blockId: block.id,
              startOffset: start,
              endOffset: Math.min(text.length, start + targetText.length),
              confidence: score,
            };
          }
        }
      }
    }
  }

  return bestMatch;
}
