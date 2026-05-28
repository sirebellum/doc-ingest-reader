import { isTabletWidth, getScrollAction } from '../FlashListReader';

describe('FlashListReader Pure Helper Logic', () => {
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
      // 500 is in the middle of 3000 (10% boundary is 300)
      const action = getScrollAction(500, 1000, 3000, prevSec, nextSec);
      expect(action).toBeNull();
    });

    it('should trigger prev prefetch when scroll position is near the top chapter limit', () => {
      const action = getScrollAction(150, 1000, 3000, prevSec, nextSec);
      expect(action).toEqual({ sectionId: 'sec-1', direction: 'prev' });
    });

    it('should trigger next prefetch when scroll position is near the bottom chapter limit', () => {
      // 1850 + 1000 = 2850 (which is inside 90% of 3000, i.e., past 2700)
      const action = getScrollAction(1850, 1000, 3000, prevSec, nextSec);
      expect(action).toEqual({ sectionId: 'sec-3', direction: 'next' });
    });

    it('should return null if scrolling near boundaries but no adjacent sections are configured', () => {
      const topAction = getScrollAction(150, 1000, 3000, undefined, nextSec);
      expect(topAction).toBeNull();

      const bottomAction = getScrollAction(1850, 1000, 3000, prevSec, undefined);
      expect(bottomAction).toBeNull();
    });
  });
});
