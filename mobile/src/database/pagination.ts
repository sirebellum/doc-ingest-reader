import { getPlainTextFromAST } from '../utils/ast';
import { DbsBridge } from '../native/DbsBridge';

export interface Block {
  id: string;
  section_id: string;
  document_id: string;
  block_type: string;
  content: string;
  sort_order: number;
  estimated_height?: number;
}

export interface TypographyConfig {
  fontSize: number;
  lineHeight: number;
  fontFamily?: string;
}

export interface ViewportDimensions {
  width: number;
  height: number;
}

export interface PageSegment {
  blockId: string;
  startOffset: number;
  endOffset: number;
  isPartial: boolean;
}

export interface ChapterPage {
  pageIndex: number;
  segments: PageSegment[];
}

/**
 * Highly accurate visual height estimation algorithm for XHTML dynamic block types in logical pixels,
 * accounting for custom font size, line height, and viewport dimensions.
 */
export function estimateDynamicBlockHeight(
  block: Block,
  viewport: ViewportDimensions,
  typography: TypographyConfig
): number {
  const content = block.content || '';
  const fontSize = typography.fontSize;
  const lineHeight = typography.lineHeight;
  const containerWidth = Math.max(100, viewport.width - 32);

  // 1. Heading blocks
  if (block.block_type === 'heading') {
    const headingFontSize = fontSize * 1.3;
    const headingLineHeight = headingFontSize * 1.4;
    return headingLineHeight + 24;
  }

  // 2. Code blocks
  if (block.block_type === 'code') {
    let lines = 1;
    try {
      const ast = JSON.parse(content);
      if (ast.type === 'code_block') {
        lines = (ast.code || '').split(/\n/).length;
      }
    } catch {
      lines = content.split(/\n/).length;
    }
    return Math.max(1, lines) * (fontSize * 1.3) + 32;
  }

  // 3. Table blocks
  if (block.block_type === 'table') {
    let rows = 1;
    try {
      const ast = JSON.parse(content);
      if (ast.type === 'table') {
        rows = (ast.rows || []).length;
      }
    } catch {}
    return Math.max(1, rows) * (fontSize * 1.8) + 36;
  }

  // 4. Image blocks (sandboxed PNGs)
  if (block.block_type === 'image') {
    return Math.min(300, viewport.height * 0.4);
  }

  // 5. Math blocks (KaTeX)
  if (block.block_type === 'math') {
    return fontSize * 3 + 20;
  }

  // 6. Paragraph or quote blocks (wrap text based on average character line bounds)
  const plainText = getPlainTextFromAST(content);
  const charCount = plainText.length;
  if (charCount === 0) return fontSize * 1.5 + 16;

  const charWidth = fontSize * 0.55;
  const charsPerLine = Math.max(15, Math.floor(containerWidth / charWidth));
  const lineCount = Math.ceil(charCount / charsPerLine);

  return lineCount * lineHeight + 16;
}

/**
 * Retrieves the cached layout height for a block from SQLite, calculating and writing it if not present.
 */
export async function getOrCacheDynamicBlockHeight(
  dbInstance: any,
  block: Block,
  viewport: ViewportDimensions,
  typography: TypographyConfig
): Promise<number> {
  const estimated = estimateDynamicBlockHeight(block, viewport, typography);
  return await DbsBridge.getOrCacheLayoutHeightAsync(block.id, estimated);
}

/**
 * Evicts all cached entries from the layout_height_cache table.
 */
export async function evictLayoutHeightCache(dbInstance: any): Promise<void> {
  await DbsBridge.evictLayoutHeightCacheAsync();
}

/**
 * Dynamic Reflow Page Splitting & Pagination Mapper.
 * Partitions chapters into precise page indexes under different screen sizes and scales.
 */
export async function paginateBlocks(
  blocks: Block[],
  viewport: ViewportDimensions,
  typography: TypographyConfig,
  dbInstance?: any
): Promise<ChapterPage[]> {
  const pages: ChapterPage[] = [];
  let currentPageIndex = 0;
  let currentPageSegments: PageSegment[] = [];
  let currentAccumulatedHeight = 0;

  const pageHeightLimit = Math.max(200, viewport.height - 100);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const plainText = getPlainTextFromAST(block.content);
    const plainTextLength = plainText.length;

    const blockHeight = dbInstance
      ? await getOrCacheDynamicBlockHeight(dbInstance, block, viewport, typography)
      : estimateDynamicBlockHeight(block, viewport, typography);

    if (plainTextLength === 0 && block.block_type !== 'image' && block.block_type !== 'table') {
      continue;
    }

    let remainingOffset = 0;
    let remainingHeight = blockHeight;

    while (remainingOffset < plainTextLength || (plainTextLength === 0 && remainingHeight > 0)) {
      if (plainTextLength === 0) {
        if (currentAccumulatedHeight + remainingHeight <= pageHeightLimit) {
          currentPageSegments.push({
            blockId: block.id,
            startOffset: 0,
            endOffset: 0,
            isPartial: false
          });
          currentAccumulatedHeight += remainingHeight;
          remainingHeight = 0;
        } else {
          if (currentAccumulatedHeight > 0) {
            pages.push({
              pageIndex: currentPageIndex++,
              segments: currentPageSegments
            });
            currentPageSegments = [];
            currentAccumulatedHeight = 0;
          } else {
            currentPageSegments.push({
              blockId: block.id,
              startOffset: 0,
              endOffset: 0,
              isPartial: false
            });
            pages.push({
              pageIndex: currentPageIndex++,
              segments: currentPageSegments
            });
            currentPageSegments = [];
            currentAccumulatedHeight = 0;
            remainingHeight = 0;
          }
        }
        continue;
      }

      const fractionRemaining = (plainTextLength - remainingOffset) / plainTextLength;
      const estimatedSegmentHeight = blockHeight * fractionRemaining;

      if (currentAccumulatedHeight + estimatedSegmentHeight <= pageHeightLimit) {
        currentPageSegments.push({
          blockId: block.id,
          startOffset: remainingOffset,
          endOffset: plainTextLength,
          isPartial: remainingOffset > 0
        });
        currentAccumulatedHeight += estimatedSegmentHeight;
        remainingOffset = plainTextLength;
      } else {
        if (currentAccumulatedHeight > 0) {
          pages.push({
            pageIndex: currentPageIndex++,
            segments: currentPageSegments
          });
          currentPageSegments = [];
          currentAccumulatedHeight = 0;
        } else {
          const availableFraction = pageHeightLimit / blockHeight;
          const charsFitting = Math.max(50, Math.floor(plainTextLength * availableFraction));
          let splitIndex = remainingOffset + charsFitting;

          if (splitIndex >= plainTextLength) {
            splitIndex = plainTextLength;
          } else {
            const nextSpace = plainText.indexOf(' ', splitIndex);
            const prevSpace = plainText.lastIndexOf(' ', splitIndex);
            
            if (prevSpace > remainingOffset && splitIndex - prevSpace < 30) {
              splitIndex = prevSpace;
            } else if (nextSpace !== -1 && nextSpace - splitIndex < 30) {
              splitIndex = nextSpace;
            }
          }

          currentPageSegments.push({
            blockId: block.id,
            startOffset: remainingOffset,
            endOffset: splitIndex,
            isPartial: true
          });

          pages.push({
            pageIndex: currentPageIndex++,
            segments: currentPageSegments
          });
          currentPageSegments = [];
          currentAccumulatedHeight = 0;

          const parsedChars = splitIndex - remainingOffset;
          remainingOffset = splitIndex;
          remainingHeight -= (parsedChars / plainTextLength) * blockHeight;
        }
      }
    }
  }

  if (currentPageSegments.length > 0) {
    pages.push({
      pageIndex: currentPageIndex,
      segments: currentPageSegments
    });
  }

  return pages;
}
