import { ASTNode } from '../../../rust_core/contracts/bindings/ASTNode';

/**
 * Recursively extracts plain text from a Semantic AST Node.
 */
export function getPlainTextFromAST(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') {
    try {
      const parsed = JSON.parse(node);
      return getPlainTextFromAST(parsed);
    } catch {
      return node;
    }
  }
  if (node.type === 'text') {
    return node.text || '';
  }
  let text = '';
  if (Array.isArray(node.children)) {
    text += node.children.map(getPlainTextFromAST).join(' ');
  }
  if (Array.isArray(node.rows)) {
    node.rows.forEach((row: any) => {
      if (Array.isArray(row.cells)) {
        row.cells.forEach((cell: any) => {
          text += getPlainTextFromAST(cell) + ' ';
        });
      }
    });
  }
  if (Array.isArray(node.items)) {
    node.items.forEach((item: any) => {
      text += getPlainTextFromAST(item) + ' ';
    });
  }
  return text.trim().replace(/\s+/g, ' ');
}
