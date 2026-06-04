import React from 'react';
import { create, act } from 'react-test-renderer';
import { Alert } from 'react-native';
import LibraryScreen from '../../app/index';
import { router } from 'expo-router';
import { db } from '../../src/database/schema';
import { RustParserBridge } from '../../src/native/RustParserBridge';

// Mock react-native FlatList to actually render children in the test renderer
jest.mock('react-native', () => {
  const React = require('react');
  const mockRN = jest.requireActual('../../src/__mocks__/react-native.ts');
  return {
    ...mockRN,
    FlatList: jest.fn(({ data, renderItem }) => {
      return React.createElement('FlatList', null, data ? data.map((item: any, idx: number) => renderItem({ item, index: idx })) : null);
    }),
  };
});

// Mock expo-router
jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
  },
}));

// Mock Database Sync Hook
const mockRefreshLibrary = jest.fn();
const mockDocuments = [
  { id: 'doc-1', title: 'Advanced SQL Ingestion.pdf', sha256_hash: 'hash-1', author: 'Ingest User' },
  { id: 'doc-2', title: 'Cosmic Rays.pdf', sha256_hash: 'hash-2', author: 'Astronomy User' }
];

jest.mock('../../src/hooks/useDatabaseSync', () => ({
  useDatabaseSync: () => ({
    corpora: [],
    documents: mockDocuments,
    refreshLibrary: mockRefreshLibrary,
  }),
}));

// Mock SQLite schema
const mockExecAsync = jest.fn();
const mockExecSync = jest.fn();
jest.mock('../../src/database/schema', () => ({
  db: {
    execAsync: (...args: any[]) => mockExecAsync(...args),
    execSync: (...args: any[]) => mockExecSync(...args),
  },
}));

// Mock JSI Rust Bridge
const mockParsePDFAsync = jest.fn();
const mockRunInferenceAsync = jest.fn();
jest.mock('../../src/native/RustParserBridge', () => ({
  RustParserBridge: {
    parsePDFAsync: (...args: any[]) => mockParsePDFAsync(...args),
    runInferenceAsync: (...args: any[]) => mockRunInferenceAsync(...args),
  },
}));

describe('LibraryScreen Component Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Alert.alert as jest.Mock).mockImplementation(() => {});
  });

  afterEach(() => {
    // No spy cleanup required since Alert is a mocked module exports rather than native spy
  });

  it('should render the Library Dashboard screen layout correctly', () => {
    const renderTree = create(<LibraryScreen />);
    const root = renderTree.root;

    // Check header text
    const header = root.findByProps({ children: 'Library' });
    expect(header).toBeDefined();

    // Check button to Ingest New Document
    const uploadBtn = root.findByProps({ children: '+' });
    expect(uploadBtn).toBeDefined();

    // Verify both mocked documents are rendered in FlatList items
    const doc1 = root.findByProps({ children: 'Advanced SQL Ingestion.pdf' });
    const doc2 = root.findByProps({ children: 'Cosmic Rays.pdf' });
    expect(doc1).toBeDefined();
    expect(doc2).toBeDefined();
  });

  it('should navigate to the Reader dynamic route `/reader/[id]` when a document item is pressed', () => {
    const renderTree = create(<LibraryScreen />);
    const root = renderTree.root;

    const doc1Text = root.findByProps({ children: 'Advanced SQL Ingestion.pdf' });
    const docItem = doc1Text.parent;
    expect(docItem).toBeDefined();

    // Simulate pressing first doc item
    docItem!.props.onPress();

    expect(router.push).toHaveBeenCalledWith('/reader/doc-1');
  });

  it('should prompt the user with LLM ingestion options when "+" is pressed', () => {
    const renderTree = create(<LibraryScreen />);
    const root = renderTree.root;

    const uploadBtnText = root.findByProps({ children: '+' });
    const uploadBtn = uploadBtnText.parent;
    uploadBtn!.props.onPress();

    expect(Alert.alert).toHaveBeenCalledWith(
      'Document Upload Ingestion',
      expect.stringContaining('Inbound file'),
      expect.any(Array)
    );
  });

  it('should execute the cloud route ingestion pipeline successfully', async () => {
    const renderTree = create(<LibraryScreen />);
    const root = renderTree.root;

    const mockPageText = JSON.stringify({
      document_id: 'doc-mock',
      page_number: 1,
      overlap_context: '',
      raw_text: 'sample content',
      layout_hints: []
    });

    // Mock JSI PDF Static parser returning parsed page data
    mockParsePDFAsync.mockResolvedValueOnce(mockPageText);
    mockExecAsync.mockResolvedValueOnce(undefined); // Mock transaction execution success

    // Capture Alert options to simulate pressing 'Cloud Processing'
    let alertOptions: any[] = [];
    (Alert.alert as jest.Mock).mockImplementation((title, message, options) => {
      alertOptions = options;
    });

    // Press upload button to trigger alert
    const uploadBtnText = root.findByProps({ children: '+' });
    const uploadBtn = uploadBtnText.parent;
    uploadBtn!.props.onPress();

    // Find the Cloud Processing button (usually index 2: Local [0], Network [1], Cloud [2])
    const cloudBtn = alertOptions.find(opt => opt.text === 'Cloud Processing (Estimated: ~5-10 mins)');
    expect(cloudBtn).toBeDefined();

    // Trigger Cloud Ingestion
    await act(async () => {
      await cloudBtn.onPress();
    });

    expect(mockParsePDFAsync).toHaveBeenCalledWith('docs/sample.pdf');
    expect(mockExecAsync).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO documents'));
    expect(mockRefreshLibrary).toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenLastCalledWith('Success', 'Document ingested successfully.');
  });

  it('should execute the local model route ingestion pipeline successfully', async () => {
    const renderTree = create(<LibraryScreen />);
    const root = renderTree.root;

    const mockPageText = JSON.stringify({
      document_id: 'doc-mock',
      page_number: 1,
      overlap_context: '',
      raw_text: 'sample content',
      layout_hints: []
    });

    const mockInferenceOutput = JSON.stringify({
      blocks: [
        {
          block_type: 'heading',
          html_content: '<h2>Local Heading</h2>',
          semantic_tags: ['local']
        }
      ]
    });

    mockParsePDFAsync.mockResolvedValueOnce(mockPageText);
    mockRunInferenceAsync.mockResolvedValueOnce(mockInferenceOutput);
    mockExecAsync.mockResolvedValueOnce(undefined);

    let alertOptions: any[] = [];
    (Alert.alert as jest.Mock).mockImplementation((title, message, options) => {
      alertOptions = options;
    });

    const uploadBtnText = root.findByProps({ children: '+' });
    const uploadBtn = uploadBtnText.parent;
    uploadBtn!.props.onPress();

    const localBtn = alertOptions.find(opt => opt.text === 'Local Inference (Estimated: ~45-60 mins)');
    expect(localBtn).toBeDefined();

    await act(async () => {
      await localBtn.onPress();
    });

    expect(mockParsePDFAsync).toHaveBeenCalledWith('docs/sample.pdf');
    expect(mockRunInferenceAsync).toHaveBeenCalledWith('models/llama3.gguf', mockPageText);
    expect(mockExecAsync).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO documents'));
    expect(mockRefreshLibrary).toHaveBeenCalled();
  });

  it('should handle ingestion failures, rollback and alert the user with the error message', async () => {
    const renderTree = create(<LibraryScreen />);
    const root = renderTree.root;

    // Simulate PDF Static Parser failure
    const errorMsg = 'Failed to extract PDF coordinates';
    mockParsePDFAsync.mockRejectedValueOnce(new Error(errorMsg));

    let alertOptions: any[] = [];
    (Alert.alert as jest.Mock).mockImplementation((title, message, options) => {
      alertOptions = options;
    });

    const uploadBtnText = root.findByProps({ children: '+' });
    const uploadBtn = uploadBtnText.parent;
    uploadBtn!.props.onPress();

    const cloudBtn = alertOptions.find(opt => opt.text === 'Cloud Processing (Estimated: ~5-10 mins)');
    
    await act(async () => {
      await cloudBtn.onPress();
    });

    expect(mockExecSync).toHaveBeenCalledWith('ROLLBACK;');
    expect(Alert.alert).toHaveBeenLastCalledWith('Ingestion Failed', errorMsg);
  });
});
