import React from 'react';
import { create, act } from 'react-test-renderer';
import { useLocalSearchParams } from 'expo-router';
import { DbsBridge } from '../../../src/native/DbsBridge';
import { useDatabaseSync } from '../../../src/hooks/useDatabaseSync';
import { FlashListReader, NoteEditor } from '../../../src/components';
import BottomSheet from '@gorhom/bottom-sheet';
import { useWindowDimensions, Alert } from 'react-native';
import ReadingScreen from '../../../app/reader/[id]';

// Mock expo-router search param
jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn().mockReturnValue({ id: 'doc-1' }),
}));

// Mock react-native-gesture-handler
jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  return {
    GestureHandlerRootView: ({ children }: any) => React.createElement('GestureHandlerRootView', null, children),
  };
});

// Mock @gorhom/bottom-sheet
const mockExpand = jest.fn();
const mockClose = jest.fn();
jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: React.forwardRef(({ children }: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({
        expand: mockExpand,
        close: mockClose,
      }));
      return React.createElement('BottomSheet', null, children);
    }),
    BottomSheetView: ({ children }: any) => React.createElement('BottomSheetView', null, children),
  };
});

// Mock custom components
jest.mock('../../../src/components', () => {
  const React = require('react');
  return {
    FlashListReader: ({ blocks, onPressBlock }: any) => {
      return React.createElement('FlashListReader', { blocks, onPressBlock }, null);
    },
    isTabletWidth: (width: number) => width >= 768,
    StickyPaginationBar: () => React.createElement('StickyPaginationBar', null, null),
    NoteEditor: ({ onSave, onDelete, onCancel }: any) => {
      return React.createElement('NoteEditor', { onSave, onDelete, onCancel }, null);
    },
  };
});

// Mock useDatabaseSync React Context Hook
const mockLoadSectionsForDocument = jest.fn();
const mockUseDatabaseSyncValue = {
  documents: [{ id: 'doc-1', title: 'Advanced SQL Ingestion.pdf', sha256_hash: 'hash-1' }],
  sections: [
    { id: 'sec-1', title: 'Chapter 1: Foundations', sort_order: 1 },
    { id: 'sec-2', title: 'Chapter 2: Scaling', sort_order: 2 }
  ],
  loadSectionsForDocument: mockLoadSectionsForDocument,
};

jest.mock('../../../src/hooks/useDatabaseSync', () => ({
  useDatabaseSync: () => mockUseDatabaseSyncValue,
}));

// Mock DbsBridge
const mockGetBlocksForSectionAsync = jest.fn();
const mockGetAnnotationsForBlocksAsync = jest.fn();
const mockSaveAnnotationAsync = jest.fn();
const mockDeleteAnnotationAsync = jest.fn();

jest.mock('../../../src/native/DbsBridge', () => ({
  DbsBridge: {
    getBlocksForSectionAsync: (...args: any[]) => mockGetBlocksForSectionAsync(...args),
    getAnnotationsForBlocksAsync: (...args: any[]) => mockGetAnnotationsForBlocksAsync(...args),
    saveAnnotationAsync: (...args: any[]) => mockSaveAnnotationAsync(...args),
    deleteAnnotationAsync: (...args: any[]) => mockDeleteAnnotationAsync(...args),
  },
}));

describe('ReadingScreen (reader/[id]) Screen Component Tests', () => {
  let selectionCallback: any = null;

  beforeEach(() => {
    jest.clearAllMocks();
    (useWindowDimensions as jest.Mock).mockReturnValue({ width: 375, height: 812 }); // Default: Smartphone
    (Alert.alert as jest.Mock).mockImplementation(() => {});

    selectionCallback = null;
    (global as any).window = {
      getSelection: jest.fn().mockReturnValue({
        toString: () => '',
        anchorNode: null,
        focusNode: null,
        removeAllRanges: jest.fn()
      })
    };

    (global as any).document = {
      body: {},
      addEventListener: jest.fn((event, callback) => {
        if (event === 'selectionchange') {
          selectionCallback = callback;
        }
      }),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn((event) => {
        if (event.type === 'selectionchange' && selectionCallback) {
          selectionCallback();
        }
        return true;
      })
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete (global as any).window;
    delete (global as any).document;
  });

  it('should render the smartphone reading layout correctly (shows title and active reader pane)', async () => {
    mockGetBlocksForSectionAsync.mockResolvedValue([]);

    let renderTree: any;
    await act(async () => {
      renderTree = create(<ReadingScreen />);
    });

    const root = renderTree.root;

    // Verify Title header is loaded
    const titleHeader = root.findByProps({ children: 'Advanced SQL Ingestion.pdf' });
    expect(titleHeader).toBeDefined();

    // Verify Smartphone elements rendered
    expect(root.findByType(FlashListReader)).toBeDefined();
    expect(root.findByType(BottomSheet)).toBeDefined();
  });

  it('should render the tablet split layout correctly (shows Left Sidebar and Right Note Sidebar when note is active)', async () => {
    // Mock tablet window dimensions
    (useWindowDimensions as jest.Mock).mockReturnValue({ width: 1024, height: 768 });
    mockGetBlocksForSectionAsync.mockResolvedValue([]);

    let renderTree: any;
    await act(async () => {
      renderTree = create(<ReadingScreen />);
    });

    const root = renderTree.root;

    // Check that Left TOC Sidebar is rendered
    const tocSidebarTitle = root.findByProps({ children: 'Table of Contents' });
    expect(tocSidebarTitle).toBeDefined();

    // Verify sections lists are rendered
    const ch1 = root.findByProps({ children: 'Chapter 1: Foundations' });
    const ch2 = root.findByProps({ children: 'Chapter 2: Scaling' });
    expect(ch1).toBeDefined();
    expect(ch2).toBeDefined();

    // Verify NoteEditor is initially not visible on tablet sidepanel
    expect(() => root.findByType(NoteEditor)).toThrow();
  });

  it('should call loadSectionsForDocument on mount with parameters from route search params', async () => {
    mockGetBlocksForSectionAsync.mockResolvedValue([]);

    await act(async () => {
      create(<ReadingScreen />);
    });

    expect(mockLoadSectionsForDocument).toHaveBeenCalledWith('doc-1');
  });

  it('should fetch blocks and existing annotations for active section from SQLite and populate FlashListReader', async () => {
    const mockBlocks = [
      { id: 'b1', document_id: 'doc-1', section_id: 'sec-1', block_type: 'paragraph', content: 'Database operations' }
    ];
    const mockAnnotations = [
      { id: 'a1', document_id: 'doc-1', block_id: 'b1', annotation_type: 'highlight', color_code: 'yellow' }
    ];

    mockGetBlocksForSectionAsync.mockResolvedValue(mockBlocks);
    mockGetAnnotationsForBlocksAsync.mockResolvedValue(mockAnnotations);

    let renderTree: any;
    await act(async () => {
      renderTree = create(<ReadingScreen />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGetBlocksForSectionAsync).toHaveBeenCalledWith('sec-1');
    expect(mockGetAnnotationsForBlocksAsync).toHaveBeenCalledWith(['b1']);

    const flashList = renderTree.root.findByType(FlashListReader);
    expect(flashList.props.blocks).toEqual(mockBlocks);
  });

  it('should trigger bottom sheet expand on smartphone floating annotate button press', async () => {
    const mockBlocks = [{ id: 'b1', document_id: 'doc-1', section_id: 'sec-1', block_type: 'paragraph', content: 'Mock Content text here.' }];
    mockGetBlocksForSectionAsync.mockResolvedValue(mockBlocks);
    mockGetAnnotationsForBlocksAsync.mockResolvedValue([]);

    let renderTree: any;
    await act(async () => {
      renderTree = create(<ReadingScreen />);
    });

    const originalGetSelection = window.getSelection;
    window.getSelection = () => ({
      toString: () => 'Mock Content',
      anchorNode: {
        parentNode: {
          getAttribute: (name: string) => name === 'data-testid' ? 'block-cell-b1' : null,
          parentNode: null
        }
      },
      focusNode: null,
      removeAllRanges: jest.fn()
    } as any);

    await act(async () => {
      document.dispatchEvent(new Event('selectionchange'));
    });

    const floatingBtn = renderTree.root.findByProps({ testID: 'floating-annotate-button' });
    expect(floatingBtn).toBeDefined();

    await act(async () => {
      floatingBtn.props.onPress();
    });

    expect(mockExpand).toHaveBeenCalled();

    // Verify NoteEditor is now rendered inside BottomSheet
    const noteEditor = renderTree.root.findByType(NoteEditor);
    expect(noteEditor).toBeDefined();
    expect(noteEditor.props.annotationId).toBeDefined();
    window.getSelection = originalGetSelection;
  });

  it('should show NoteEditor right sidebar in tablet profile when text is highlighted and floating button is clicked', async () => {
    (useWindowDimensions as jest.Mock).mockReturnValue({ width: 1024, height: 768 });
    const mockBlocks = [{ id: 'b1', document_id: 'doc-1', section_id: 'sec-1', block_type: 'paragraph', content: 'Mock Content.' }];
    mockGetBlocksForSectionAsync.mockResolvedValue(mockBlocks);
    mockGetAnnotationsForBlocksAsync.mockResolvedValue([]);

    let renderTree: any;
    await act(async () => {
      renderTree = create(<ReadingScreen />);
    });

    const originalGetSelection = window.getSelection;
    window.getSelection = () => ({
      toString: () => 'Mock Highlight Text',
      anchorNode: {
        parentNode: {
          getAttribute: (name: string) => name === 'data-testid' ? 'block-cell-b1' : null,
          parentNode: null
        }
      },
      focusNode: null,
      removeAllRanges: jest.fn()
    } as any);

    await act(async () => {
      document.dispatchEvent(new Event('selectionchange'));
    });

    const floatingBtn = renderTree.root.findByProps({ testID: 'floating-annotate-button' });
    await act(async () => {
      floatingBtn.props.onPress();
    });

    // NoteEditor is displayed in the split screen layout directly
    const noteEditor = renderTree.root.findByType(NoteEditor);
    expect(noteEditor).toBeDefined();
    expect(mockExpand).not.toHaveBeenCalled(); // BottomSheet not touched on tablet
    window.getSelection = originalGetSelection;
  });

  it('should insert a new highlight annotation into SQLite when save is called on new note via floating button flow', async () => {
    const mockBlocks = [{ id: 'b1', document_id: 'doc-1', section_id: 'sec-1', block_type: 'paragraph', content: 'New Text content.' }];
    mockGetBlocksForSectionAsync.mockResolvedValue(mockBlocks);
    mockGetAnnotationsForBlocksAsync.mockResolvedValue([]);
    mockSaveAnnotationAsync.mockResolvedValue(undefined);

    let renderTree: any;
    await act(async () => {
      renderTree = create(<ReadingScreen />);
    });

    const originalGetSelection = window.getSelection;
    window.getSelection = () => ({
      toString: () => 'Mock Highlight Text',
      anchorNode: {
        parentNode: {
          getAttribute: (name: string) => name === 'data-testid' ? 'block-cell-b1' : null,
          parentNode: null
        }
      },
      focusNode: null,
      removeAllRanges: jest.fn()
    } as any);

    await act(async () => {
      document.dispatchEvent(new Event('selectionchange'));
    });

    const floatingBtn = renderTree.root.findByProps({ testID: 'floating-annotate-button' });
    await act(async () => {
      floatingBtn.props.onPress();
    });

    const noteEditor = renderTree.root.findByType(NoteEditor);
    
    // Trigger Save
    await act(async () => {
      await noteEditor.props.onSave('yellow', 'My new notes.', ['sqlite'], 'Mock Highlight Text');
    });

    expect(mockSaveAnnotationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        document_id: 'doc-1',
        block_id: 'b1',
        annotation_type: 'highlight',
        color_code: 'yellow'
      })
    );
    expect(mockClose).toHaveBeenCalled(); // BottomSheet closed after save
    window.getSelection = originalGetSelection;
  });

  it('should update highlight annotation in SQLite when save is called on existing note', async () => {
    const mockBlocks = [{ id: 'b1', document_id: 'doc-1', section_id: 'sec-1', content: 'Some text.' }];
    const mockAnnotations = [{ id: 'a1', document_id: 'doc-1', block_id: 'b1', annotation_type: 'highlight', color_code: 'yellow', note_body: 'Old note' }];
    mockGetBlocksForSectionAsync.mockResolvedValue(mockBlocks);
    mockGetAnnotationsForBlocksAsync.mockResolvedValue(mockAnnotations);
    
    mockSaveAnnotationAsync.mockResolvedValue(undefined);

    let renderTree: any;
    await act(async () => {
      renderTree = create(<ReadingScreen />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    const flashList = renderTree.root.findByType(FlashListReader);

    // Simulate tapping block with existing annotation
    await act(async () => {
      flashList.props.onPressBlock(mockBlocks[0], mockAnnotations);
    });

    const noteEditor = renderTree.root.findByType(NoteEditor);
    
    // Trigger Save to update
    await act(async () => {
      await noteEditor.props.onSave('blue', 'Updated note content.', ['sqlite']);
    });

    expect(mockSaveAnnotationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'a1',
        color_code: 'blue',
        note_body: 'Updated note content.'
      })
    );
  });

  it('should delete annotations from SQLite when delete is pressed inside NoteEditor', async () => {
    const mockBlocks = [{ id: 'b1', document_id: 'doc-1', section_id: 'sec-1', content: 'Some text.' }];
    const mockAnnotations = [{ id: 'a1', document_id: 'doc-1', block_id: 'b1', annotation_type: 'highlight', color_code: 'yellow', note_body: 'Delete me.' }];
    mockGetBlocksForSectionAsync.mockResolvedValue(mockBlocks);
    mockGetAnnotationsForBlocksAsync.mockResolvedValue(mockAnnotations);
    
    mockDeleteAnnotationAsync.mockResolvedValue(undefined);

    let renderTree: any;
    await act(async () => {
      renderTree = create(<ReadingScreen />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    const flashList = renderTree.root.findByType(FlashListReader);

    await act(async () => {
      flashList.props.onPressBlock(mockBlocks[0], mockAnnotations);
    });

    const noteEditor = renderTree.root.findByType(NoteEditor);
    
    // Trigger Delete
    await act(async () => {
      await noteEditor.props.onDelete();
    });

    expect(mockDeleteAnnotationAsync).toHaveBeenCalledWith('a1');
  });
});
