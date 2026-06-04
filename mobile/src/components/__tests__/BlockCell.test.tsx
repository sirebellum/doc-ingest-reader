import React from 'react';
import { BlockCell } from '../BlockCell';

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock-sandbox/',
}));

describe('BlockCell Component AST Rendering', () => {
  it('should construct a BlockCell element for Heading node', () => {
    const headingBlock = {
      id: 'b-heading',
      section_id: 'sec-1',
      document_id: 'doc-1',
      block_type: 'heading',
      content: JSON.stringify({
        type: 'heading',
        level: 2,
        children: [{ type: 'text', text: 'Section Heading', bold: null, italic: null, code: null }]
      }),
      sort_order: 1,
    };

    const element = (
      <BlockCell
        block={headingBlock}
        annotations={[]}
      />
    );

    expect(element.type).toBe(BlockCell);
    expect(element.props.block).toEqual(headingBlock);
  });

  it('should construct a BlockCell element for Paragraph node', () => {
    const paragraphBlock = {
      id: 'b-para',
      section_id: 'sec-1',
      document_id: 'doc-1',
      block_type: 'paragraph',
      content: JSON.stringify({
        type: 'paragraph',
        children: [{ type: 'text', text: 'This is paragraph content.', bold: null, italic: null, code: null }]
      }),
      sort_order: 2,
    };

    const element = (
      <BlockCell
        block={paragraphBlock}
        annotations={[]}
      />
    );

    expect(element.type).toBe(BlockCell);
    expect(element.props.block.id).toBe('b-para');
  });

  it('should handle malformed JSON fallback gracefully', () => {
    const malformedBlock = {
      id: 'b-malformed',
      section_id: 'sec-1',
      document_id: 'doc-1',
      block_type: 'paragraph',
      content: 'Hello legacy raw string content',
      sort_order: 3,
    };

    const element = (
      <BlockCell
        block={malformedBlock}
        annotations={[]}
      />
    );

    expect(element.type).toBe(BlockCell);
    expect(element.props.block.content).toBe('Hello legacy raw string content');
  });
});
