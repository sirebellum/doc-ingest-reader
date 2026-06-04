import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';

/**
 * Checks if device sharing is supported
 */
export async function isSharingAvailable(): Promise<boolean> {
  try {
    if (!Sharing || typeof Sharing.isAvailableAsync !== 'function') {
      return false;
    }
    return await Sharing.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Exports note packet JSON payload using native Sharing Tray
 */
export async function exportNotesShareSheet(payload: any, filename: string = 'shared_notes.json'): Promise<string | null> {
  const isAvailable = await isSharingAvailable();
  const cacheDir = FileSystem.cacheDirectory || 'file:///mock-cache/';
  const fileUri = `${cacheDir}${filename}`;

  await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(payload, null, 2), {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (isAvailable) {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/json',
      dialogTitle: 'Export Notes Backup',
      UTI: 'public.json',
    });
  }

  return fileUri;
}

/**
 * Imports shared Note Packet from a file URI using expo-file-system
 */
export async function importNotesFromUri(fileUri: string): Promise<any> {
  const content = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  return JSON.parse(content);
}
