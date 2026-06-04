import { getDatabaseAdapter } from './backup';

export interface Block {
  id: string;
  section_id: string;
  document_id: string;
  block_type: string;
  content: string;
  sort_order: number;
}

/**
 * Highly accurate visual height estimation algorithm for XHTML dynamic block types in logical pixels.
 */
export function estimateBlockHeight(block: Block): number {
  const content = block.content || '';

  // 1. Heading blocks
  if (
    block.block_type === 'heading' || 
    content.toLowerCase().startsWith('<h1') || 
    content.toLowerCase().startsWith('<h2') || 
    content.toLowerCase().startsWith('<h3')
  ) {
    return 60;
  }

  // 2. Code blocks
  if (block.block_type === 'code' || content.toLowerCase().includes('<code>') || content.toLowerCase().includes('<pre>')) {
    const lines = content.split(/\n|<br>/gi).length;
    return Math.max(1, lines) * 20 + 32;
  }

  // 3. Table blocks
  if (block.block_type === 'table' || content.toLowerCase().includes('<table>')) {
    const rows = (content.match(/<tr>/gi) || []).length;
    return Math.max(1, rows) * 40 + 36;
  }

  // 4. Image blocks (sandboxed PNGs)
  if (block.block_type === 'image' || content.toLowerCase().includes('<img') || content.includes('local-asset://')) {
    return 300;
  }

  // 5. Math blocks (KaTeX)
  if (block.block_type === 'math' || content.toLowerCase().includes('katex') || content.toLowerCase().includes('class="math"')) {
    return 80;
  }

  // 6. Paragraph or quote blocks (wrap text based on average character line bounds)
  const plainText = content.replace(/<[^>]*>/g, '').trim();
  const charCount = plainText.length;
  if (charCount === 0) return 40; // Default floor size

  const lineCount = Math.ceil(charCount / 80);
  return lineCount * 24 + 20;
}

/**
 * Retrieves the cached layout height for a block from SQLite, calculating and writing it if not present.
 */
export function getOrCacheBlockHeight(dbInstance: any, block: Block): number {
  const db = getDatabaseAdapter(dbInstance);

  try {
    // Check if height cache exists
    const cached = db.get<{ estimated_height: number }>(
      'SELECT estimated_height FROM layout_height_cache WHERE block_id = ?;',
      [block.id]
    );

    if (cached && typeof cached.estimated_height === 'number') {
      return cached.estimated_height;
    }
  } catch (err) {
    console.warn('[LayoutCache] Cache query warning, proceeding to estimate:', err);
  }

  // Calculate height if not cached
  const height = estimateBlockHeight(block);

  try {
    // Write estimated height to the database cache table
    db.run(
      'INSERT OR REPLACE INTO layout_height_cache (block_id, estimated_height) VALUES (?, ?);',
      [block.id, height]
    );
  } catch (err) {
    console.error('[LayoutCache] Write failed:', err);
  }

  return height;
}
