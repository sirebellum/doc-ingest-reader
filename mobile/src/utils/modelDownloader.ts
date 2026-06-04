import * as FileSystem from 'expo-file-system';

const GEMMA_HF_URL = 'https://huggingface.co/google/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf';
const MODEL_DIR = `${FileSystem.documentDirectory}models/`;
const MODEL_FILE_NAME = 'gemma-3-1b-it-Q4_K_M.gguf';
export const MODEL_PATH = `${MODEL_DIR}${MODEL_FILE_NAME}`;

export interface DownloadState {
  isDownloading: boolean;
  progress: number;
  localPath: string | null;
  error: string | null;
}

/**
 * Handles Gemma-3-1b local GGUF model weight downloading and cache management
 * inside the native Expo FileSystem sandbox.
 */
export const ModelDownloader = {
  /**
   * Resolves the target directory and checks if the model file is already present.
   */
  async checkModelExists(): Promise<boolean> {
    try {
      const dirInfo = await FileSystem.getInfoAsync(MODEL_DIR);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });
        return false;
      }
      
      const fileInfo = await FileSystem.getInfoAsync(MODEL_PATH);
      return fileInfo.exists;
    } catch (e) {
      console.error('[ModelDownloader] Error checking model cache:', e);
      return false;
    }
  },

  /**
   * Fetches the local path of the model, or null if it doesn't exist yet.
   */
  async getModelPath(): Promise<string | null> {
    const exists = await this.checkModelExists();
    return exists ? MODEL_PATH : null;
  },

  /**
   * Downloads the Gemma-3-1b Q4_K_M GGUF model weights from Hugging Face.
   * Tracks progress dynamically via progress callback.
   */
  async downloadModel(onProgress?: (progress: number) => void): Promise<string> {
    // 1. Ensure target models folder exists
    const dirInfo = await FileSystem.getInfoAsync(MODEL_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });
    }

    // 2. Check if already cached
    const fileInfo = await FileSystem.getInfoAsync(MODEL_PATH);
    if (fileInfo.exists) {
      if (onProgress) onProgress(1.0);
      return MODEL_PATH;
    }

    console.log('[ModelDownloader] Initiating Gemma-3-1b download from Hugging Face...');

    const callback = (downloadProgress: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => {
      const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
      if (onProgress) {
        onProgress(Math.min(0.99, progress)); // Cap at 99% until complete disk write is verified
      }
    };

    const downloadResumable = FileSystem.createDownloadResumable(
      GEMMA_HF_URL,
      MODEL_PATH,
      {},
      callback
    );

    try {
      const result = await downloadResumable.downloadAsync();
      if (!result || !result.uri) {
        throw new Error('Download completed but returned an invalid URI payload.');
      }

      console.log('[ModelDownloader] Download completed successfully. Saved to:', result.uri);
      if (onProgress) onProgress(1.0);
      return result.uri;
    } catch (e: any) {
      console.error('[ModelDownloader] Download failed:', e);
      throw new Error(`Model download failed: ${e.message || e}`);
    }
  },

  /**
   * Deletes the cached model from the local device sandbox to free up memory/RAM.
   */
  async deleteModel(): Promise<void> {
    try {
      const fileInfo = await FileSystem.getInfoAsync(MODEL_PATH);
      if (fileInfo.exists) {
        await FileSystem.deleteAsync(MODEL_PATH);
        console.log('[ModelDownloader] Model weights deleted from sandbox.');
      }
    } catch (e) {
      console.error('[ModelDownloader] Error removing model:', e);
    }
  }
};
