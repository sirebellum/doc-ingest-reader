jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

const mockFiles: Record<string, string> = {};

jest.mock('expo-file-system', () => ({
  cacheDirectory: 'file:///mock-cache/',
  writeAsStringAsync: jest.fn().mockImplementation((uri, content) => {
    mockFiles[uri] = content;
    return Promise.resolve();
  }),
  readAsStringAsync: jest.fn().mockImplementation((uri) => {
    if (mockFiles[uri] !== undefined) {
      return Promise.resolve(mockFiles[uri]);
    }
    return Promise.reject(new Error(`File not found: ${uri}`));
  }),
  EncodingType: { UTF8: 'utf8' },
}));

import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { isSharingAvailable, exportNotesShareSheet, importNotesFromUri } from '../sharing';

describe('Expo Sharing & File System Backup Portability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key in mockFiles) {
      delete mockFiles[key];
    }
  });

  it('should detect if sharing is supported on the platform', async () => {
    const isAvail = await isSharingAvailable();
    expect(isAvail).toBe(true);
    expect(Sharing.isAvailableAsync).toHaveBeenCalled();
  });

  it('should export notes payload to cache file and trigger native sharing sheet', async () => {
    const mockPayload = { notes: ['Important annotation'] };
    const uri = await exportNotesShareSheet(mockPayload, 'packet.json');

    expect(uri).toBe('file:///mock-cache/packet.json');
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
      'file:///mock-cache/packet.json',
      JSON.stringify(mockPayload, null, 2),
      expect.any(Object)
    );
    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///mock-cache/packet.json', {
      mimeType: 'application/json',
      dialogTitle: 'Export Notes Backup',
      UTI: 'public.json',
    });
  });

  it('should read cache files and parse portable payloads correctly upon import', async () => {
    const mockPayload = { notes: ['collaborative reading highlight'] };
    const uri = 'file:///mock-cache/import_packet.json';
    
    // Seed virtual file system
    await FileSystem.writeAsStringAsync(uri, JSON.stringify(mockPayload), { encoding: 'utf8' });
    
    const parsed = await importNotesFromUri(uri);
    expect(parsed).toEqual(mockPayload);
    expect(FileSystem.readAsStringAsync).toHaveBeenCalledWith(uri, expect.any(Object));
  });
});
