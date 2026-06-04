import React from 'react';
import { create, act } from 'react-test-renderer';
import { View, Text, TouchableOpacity } from 'react-native';
import { useDatabaseSync, DatabaseProvider } from '../useDatabaseSync';
import { db } from '../../database/schema';

// Mock the database schema module
jest.mock('../../database/schema', () => ({
  db: {
    getAllAsync: jest.fn(),
  },
}));

const TestConsumer: React.FC = () => {
  const { 
    corpora, 
    documents, 
    sections, 
    refreshLibrary, 
    loadSectionsForDocument 
  } = useDatabaseSync();

  return (
    <View>
      <Text testID="corporaCount">{corpora.length}</Text>
      <Text testID="documentsCount">{documents.length}</Text>
      <Text testID="sectionsCount">{sections.length}</Text>
      <TouchableOpacity testID="refreshBtn" onPress={refreshLibrary}>
        <Text>Refresh</Text>
      </TouchableOpacity>
      <TouchableOpacity testID="loadBtn" onPress={() => loadSectionsForDocument('doc-1')}>
        <Text>Load Sections</Text>
      </TouchableOpacity>
    </View>
  );
};

describe('useDatabaseSync Custom SQLite Hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should throw an error if used outside DatabaseProvider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    
    expect(() => {
      create(<TestConsumer />);
    }).toThrow('useDatabaseSync must be used within DatabaseProvider');
    
    spy.mockRestore();
  });

  it('should fetch library documents and corpora on mount', async () => {
    const mockCorpora = [
      { id: 'c1', name: 'Science Corpus' },
    ];
    const mockDocs = [
      { id: 'd1', title: 'Physics Book', sha256_hash: 'sha1' },
      { id: 'd2', title: 'Chemistry Book', sha256_hash: 'sha2' },
    ];

    (db.getAllAsync as jest.Mock)
      .mockResolvedValueOnce(mockCorpora) // First call: corpora
      .mockResolvedValueOnce(mockDocs);   // Second call: documents

    let renderTree: any;
    await act(async () => {
      renderTree = create(
        <DatabaseProvider>
          <TestConsumer />
        </DatabaseProvider>
      );
    });

    // Wait for the double promise resolution in refreshLibrary
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(db.getAllAsync).toHaveBeenNthCalledWith(1, 'SELECT * FROM corpora ORDER BY created_at DESC');
    expect(db.getAllAsync).toHaveBeenNthCalledWith(2, 'SELECT * FROM documents ORDER BY created_at DESC');

    const corporaText = renderTree.root.findByProps({ testID: 'corporaCount' });
    const documentsText = renderTree.root.findByProps({ testID: 'documentsCount' });

    expect(corporaText.props.children).toBe(1);
    expect(documentsText.props.children).toBe(2);
  });

  it('should support manual refreshLibrary and trigger state updates', async () => {
    const mockCorpora = [{ id: 'c1', name: 'Science' }];
    const mockDocs = [{ id: 'd1', title: 'Book 1', sha256_hash: 'sha1' }];

    (db.getAllAsync as jest.Mock)
      .mockResolvedValueOnce([]) // Initial mount corpora
      .mockResolvedValueOnce([]) // Initial mount documents
      .mockResolvedValueOnce(mockCorpora) // Manual refresh corpora
      .mockResolvedValueOnce(mockDocs);   // Manual refresh documents

    let renderTree: any;
    await act(async () => {
      renderTree = create(
        <DatabaseProvider>
          <TestConsumer />
        </DatabaseProvider>
      );
    });

    const refreshBtn = renderTree.root.findByProps({ testID: 'refreshBtn' });
    
    await act(async () => {
      refreshBtn.props.onPress();
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const corporaText = renderTree.root.findByProps({ testID: 'corporaCount' });
    const documentsText = renderTree.root.findByProps({ testID: 'documentsCount' });

    expect(corporaText.props.children).toBe(1);
    expect(documentsText.props.children).toBe(1);
  });

  it('should fetch document sections dynamically when loadSectionsForDocument is invoked', async () => {
    const mockSections = [
      { id: 'sec-1', title: 'Chapter 1', sort_order: 1 },
      { id: 'sec-2', title: 'Chapter 2', sort_order: 2 },
    ];

    (db.getAllAsync as jest.Mock)
      .mockResolvedValueOnce([]) // Initial mount corpora
      .mockResolvedValueOnce([]) // Initial mount documents
      .mockResolvedValueOnce(mockSections); // Section fetch

    let renderTree: any;
    await act(async () => {
      renderTree = create(
        <DatabaseProvider>
          <TestConsumer />
        </DatabaseProvider>
      );
    });

    const loadBtn = renderTree.root.findByProps({ testID: 'loadBtn' });
    
    await act(async () => {
      loadBtn.props.onPress();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(db.getAllAsync).toHaveBeenLastCalledWith(
      'SELECT * FROM sections WHERE document_id = ? ORDER BY sort_order ASC',
      ['doc-1']
    );

    const sectionsText = renderTree.root.findByProps({ testID: 'sectionsCount' });
    expect(sectionsText.props.children).toBe(2);
  });

  it('should log an error inside console.error if database queries throw exceptions', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const errorMsg = 'Failed to load';
    (db.getAllAsync as jest.Mock).mockRejectedValue(new Error(errorMsg));

    let renderTree: any;
    await act(async () => {
      renderTree = create(
        <DatabaseProvider>
          <TestConsumer />
        </DatabaseProvider>
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(errorSpy).toHaveBeenCalledWith('Failed to fetch library from db', expect.any(Error));

    const loadBtn = renderTree.root.findByProps({ testID: 'loadBtn' });
    
    await act(async () => {
      loadBtn.props.onPress();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(errorSpy).toHaveBeenCalledWith('Failed to fetch sections for document', expect.any(Error));
    errorSpy.mockRestore();
  });
});
