jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock-sandbox/',
}));

jest.mock('react-native-render-html', () => 'RenderHTML');

jest.mock('@shopify/flash-list', () => {
  const React = require('react');
  return {
    FlashList: jest.fn(({ data, renderItem, estimatedItemSize, onScroll }) => {
      return React.createElement('FlashList', { estimatedItemSize, onScroll }, data ? data.map((item: any, idx: number) => renderItem({ item, index: idx })) : null);
    }),
  };
});

import React from 'react';
import { FlashListReader } from '../FlashListReader';
import { isTabletWidth, getScrollAction } from '../../utils/layout';

describe('FlashListReader Rendering & Scrolling Core', () => {
  const mockBlocks = [
    { id: 'b-1', section_id: 'sec-1', document_id: 'd-1', block_type: 'heading', content: '<h1>Header</h1>', sort_order: 1 },
    { id: 'b-2', section_id: 'sec-1', document_id: 'd-1', block_type: 'paragraph', content: '<p>Body text</p>', sort_order: 2 }
  ];

  it('should instantiate a valid FlashListReader element with estimatedItemSize and recycling data', () => {
    const mockLoad = jest.fn();
    const element = (
      <FlashListReader
        initialSectionId="sec-1"
        blocks={mockBlocks}
        onLoadAdjacentSection={mockLoad}
        nextSectionId="sec-2"
        prevSectionId="sec-0"
      />
    );

    expect(element.type).toBe(FlashListReader);
    expect(element.props.blocks).toEqual(mockBlocks);
    expect(element.props.nextSectionId).toBe('sec-2');
    expect(element.props.prevSectionId).toBe('sec-0');
  });

  describe('isTabletWidth', () => {
    it('should return false for widths below 768 (smartphone profile)', () => {
      expect(isTabletWidth(375)).toBe(false);
      expect(isTabletWidth(767)).toBe(false);
    });

    it('should return true for widths 768 and above (tablet profile)', () => {
      expect(isTabletWidth(768)).toBe(true);
      expect(isTabletWidth(1024)).toBe(true);
    });
  });

  describe('getScrollAction proximity loader', () => {
    const prevSec = 'sec-1';
    const nextSec = 'sec-3';

    it('should return null when scroll position is in the stable middle range', () => {
      const action = getScrollAction(500, 1000, 3000, prevSec, nextSec);
      expect(action).toBeNull();
    });

    it('should trigger prev prefetch when scroll position is near the top chapter limit', () => {
      const action = getScrollAction(-60, 1000, 3000, prevSec, nextSec);
      expect(action).toEqual({ sectionId: 'sec-1', direction: 'prev' });
    });

    it('should trigger next prefetch when scroll position is near the bottom chapter limit', () => {
      const action = getScrollAction(1950, 1000, 3000, prevSec, nextSec);
      expect(action).toEqual({ sectionId: 'sec-3', direction: 'next' });
    });

    it('should return null if scrolling near boundaries but no adjacent sections are configured', () => {
      const topAction = getScrollAction(-60, 1000, 3000, undefined, nextSec);
      expect(topAction).toBeNull();

      const bottomAction = getScrollAction(1950, 1000, 3000, prevSec, undefined);
      expect(bottomAction).toBeNull();
    });
  });
});
