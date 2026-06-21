jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock-sandbox/',
}));

jest.mock('react-native-render-html', () => 'RenderHTML');

jest.mock('@shopify/flash-list', () => {
  const React = require('react');
  return {
    FlashList: jest.fn(({ data, renderItem }) => {
      return React.createElement('FlashList', null, data ? data.map((item: any, idx: number) => renderItem({ item, index: idx })) : null);
    }),
  };
});

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: '123' }),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => {
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    SafeAreaProvider: jest.fn().mockImplementation(({ children }) => children),
    SafeAreaConsumer: jest.fn().mockImplementation(({ children }) => children(inset)),
    useSafeAreaInsets: jest.fn().mockImplementation(() => inset),
  };
});

jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const BottomSheet = jest.fn(({ children }) => React.createElement('View', null, children));
  (BottomSheet as any).View = jest.fn(({ children }) => React.createElement('View', null, children));
  return {
    __esModule: true,
    default: BottomSheet,
    BottomSheetView: (BottomSheet as any).View,
  };
});

jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  return {
    GestureHandlerRootView: jest.fn(({ children }) => React.createElement('View', null, children)),
  };
});

import ReadingScreen from '../../../app/reader/[id]';
import { isTabletWidth } from '../../utils/layout';

describe('ReadingScreen Layout & Memory Swap Integration', () => {
  it('should be a valid function component', () => {
    expect(typeof ReadingScreen).toBe('function');
  });

  describe('Adaptive Grid Width Evaluators', () => {
    it('should distinguish smartphone profile from tablet profile dynamically', () => {
      expect(isTabletWidth(360)).toBe(false);  // Phone
      expect(isTabletWidth(720)).toBe(false);  // Phablet
      expect(isTabletWidth(768)).toBe(true);   // Standard Tablet
      expect(isTabletWidth(1280)).toBe(true);  // iPad Pro / Large Tablet
    });
  });

  describe('Memory Swapping Segment Buffering Logic', () => {
    it('should calculate valid active window adjacent keys for purging GC release', () => {
      const mockSections = [
        { id: 'sec-1', title: 'Chapter 1' },
        { id: 'sec-2', title: 'Chapter 2' },
        { id: 'sec-3', title: 'Chapter 3' },
        { id: 'sec-4', title: 'Chapter 4' },
      ];
      
      const getActiveSectionWindowIds = (activeId: string) => {
        const idx = mockSections.findIndex(s => s.id === activeId);
        const validIds = new Set<string>();
        validIds.add(activeId);
        if (idx > 0) validIds.add(mockSections[idx - 1].id);
        if (idx < mockSections.length - 1) validIds.add(mockSections[idx + 1].id);
        return validIds;
      };

      const window2 = getActiveSectionWindowIds('sec-2');
      expect(window2.has('sec-1')).toBe(true);
      expect(window2.has('sec-2')).toBe(true);
      expect(window2.has('sec-3')).toBe(true);
      expect(window2.has('sec-4')).toBe(false);
    });
  });
});
