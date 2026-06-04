import { ModelDownloader, MODEL_PATH } from '../modelDownloader';
import * as FileSystem from 'expo-file-system';

// Mock expo-file-system module completely
jest.mock('expo-file-system', () => {
  return {
    documentDirectory: 'file:///mock/documents/',
    getInfoAsync: jest.fn(),
    makeDirectoryAsync: jest.fn(),
    deleteAsync: jest.fn(),
    createDownloadResumable: jest.fn()
  };
});

describe('ModelDownloader Utility Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should check if model exists and return false if directory/file is missing', async () => {
    const mockGetInfo = FileSystem.getInfoAsync as jest.Mock;
    // Mock that the models directory does not exist
    mockGetInfo.mockResolvedValueOnce({ exists: false });

    const exists = await ModelDownloader.checkModelExists();

    expect(exists).toBe(false);
    expect(FileSystem.getInfoAsync).toHaveBeenCalledWith('file:///mock/documents/models/');
    expect(FileSystem.makeDirectoryAsync).toHaveBeenCalledWith('file:///mock/documents/models/', { intermediates: true });
  });

  it('should check if model exists and return true if directory and file both exist', async () => {
    const mockGetInfo = FileSystem.getInfoAsync as jest.Mock;
    // First call: models directory exists
    mockGetInfo.mockResolvedValueOnce({ exists: true });
    // Second call: model file exists
    mockGetInfo.mockResolvedValueOnce({ exists: true });

    const exists = await ModelDownloader.checkModelExists();

    expect(exists).toBe(true);
    expect(FileSystem.getInfoAsync).toHaveBeenCalledTimes(2);
    expect(FileSystem.getInfoAsync).toHaveBeenNthCalledWith(2, MODEL_PATH);
  });

  it('should resolve the correct model path if checked successfully', async () => {
    const mockGetInfo = FileSystem.getInfoAsync as jest.Mock;
    mockGetInfo.mockResolvedValueOnce({ exists: true }); // dir exists
    mockGetInfo.mockResolvedValueOnce({ exists: true }); // file exists

    const path = await ModelDownloader.getModelPath();

    expect(path).toBe(MODEL_PATH);
  });

  it('should return null for getModelPath if model does not exist', async () => {
    const mockGetInfo = FileSystem.getInfoAsync as jest.Mock;
    mockGetInfo.mockResolvedValueOnce({ exists: false });

    const path = await ModelDownloader.getModelPath();

    expect(path).toBeNull();
  });

  it('should skip download and return path if model is already cached', async () => {
    const mockGetInfo = FileSystem.getInfoAsync as jest.Mock;
    // checkModelExists calls: dir exists, file exists
    mockGetInfo.mockResolvedValueOnce({ exists: true }); // make directory check
    mockGetInfo.mockResolvedValueOnce({ exists: true }); // download cached check

    const progressCallback = jest.fn();
    const path = await ModelDownloader.downloadModel(progressCallback);

    expect(path).toBe(MODEL_PATH);
    expect(progressCallback).toHaveBeenCalledWith(1.0);
    expect(FileSystem.createDownloadResumable).not.toHaveBeenCalled();
  });

  it('should trigger expo resumable download when model is not cached', async () => {
    const mockGetInfo = FileSystem.getInfoAsync as jest.Mock;
    mockGetInfo.mockResolvedValueOnce({ exists: true }); // make directory check
    mockGetInfo.mockResolvedValueOnce({ exists: false }); // file does not exist

    const mockDownloadAsync = jest.fn().mockResolvedValue({ uri: MODEL_PATH });
    const mockCreateDownloadResumable = FileSystem.createDownloadResumable as jest.Mock;
    mockCreateDownloadResumable.mockReturnValue({
      downloadAsync: mockDownloadAsync
    });

    const progressCallback = jest.fn();
    const path = await ModelDownloader.downloadModel(progressCallback);

    expect(path).toBe(MODEL_PATH);
    expect(FileSystem.createDownloadResumable).toHaveBeenCalledTimes(1);
    expect(mockDownloadAsync).toHaveBeenCalledTimes(1);
    expect(progressCallback).toHaveBeenCalledWith(1.0);
  });

  it('should delete the cached model cleanly if it exists', async () => {
    const mockGetInfo = FileSystem.getInfoAsync as jest.Mock;
    mockGetInfo.mockResolvedValueOnce({ exists: true }); // model exists

    await ModelDownloader.deleteModel();

    expect(FileSystem.getInfoAsync).toHaveBeenCalledWith(MODEL_PATH);
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(MODEL_PATH);
  });

  it('should do nothing on deleteModel if file is already missing', async () => {
    const mockGetInfo = FileSystem.getInfoAsync as jest.Mock;
    mockGetInfo.mockResolvedValueOnce({ exists: false }); // model missing

    await ModelDownloader.deleteModel();

    expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
  });
});
