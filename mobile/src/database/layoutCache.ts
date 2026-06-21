import { DbsBridge } from '../native/DbsBridge';

export interface Block {
  id: string;
  section_id: string;
  document_id: string;
  block_type: string;
  content: string;
  sort_order: number;
}

export function estimateBlockHeight(block: Block): number {
  const content = block.content || '';

  if (
    block.block_type === 'heading' || 
    content.toLowerCase().startsWith('<h1') || 
    content.toLowerCase().startsWith('<h2') || 
    content.toLowerCase().startsWith('<h3')
  ) {
    return 60;
  }

  if (block.block_type === 'code' || content.toLowerCase().includes('<code>') || content.toLowerCase().includes('<pre>')) {
    const lines = content.split(/\n|<br>/gi).length;
    return Math.max(1, lines) * 20 + 32;
  }

  if (block.block_type === 'table' || content.toLowerCase().includes('<table>')) {
    const rows = (content.match(/<tr>/gi) || []).length;
    return Math.max(1, rows) * 40 + 36;
  }

  if (block.block_type === 'image' || content.toLowerCase().includes('<img') || content.includes('local-asset://')) {
    return 300;
  }

  if (block.block_type === 'math' || content.toLowerCase().includes('katex') || content.toLowerCase().includes('class="math"')) {
    return 80;
  }

  const plainText = content.replace(/<[^>]*>/g, '').trim();
  const charCount = plainText.length;
  if (charCount === 0) return 40;

  const lineCount = Math.ceil(charCount / 80);
  return lineCount * 24 + 20;
}

export async function getOrCacheBlockHeight(dbInstance: any, block: Block): Promise<number> {
  const height = estimateBlockHeight(block);
  return await DbsBridge.getOrCacheLayoutHeightAsync(block.id, height);
}
