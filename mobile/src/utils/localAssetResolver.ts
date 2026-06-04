import * as FileSystem from 'expo-file-system';

/**
 * Dynamically resolves a local-asset:// custom URI to the active App Sandbox absolute path.
 */
export function resolveLocalAssetUri(uri: string): string {
  if (!uri) return '';
  if (!uri.startsWith('local-asset://')) return uri;
  
  const docDir = FileSystem.documentDirectory || '';
  const resolvedDir = docDir.endsWith('/') ? docDir : `${docDir}/`;
  
  // local-asset://[hash]_[image_id].png => [resolvedDir]documents/images/[hash]_[image_id].png
  const filename = uri.substring('local-asset://'.length);
  return `${resolvedDir}documents/images/${filename}`;
}

/**
 * Intercepts all local-asset:// URIs inside an HTML/XHTML string and maps them dynamically
 * to the active app sandbox path.
 */
export function resolveLocalAssetsInHtml(html: string): string {
  if (!html) return '';
  const docDir = FileSystem.documentDirectory || '';
  const resolvedDir = docDir.endsWith('/') ? docDir : `${docDir}/`;
  return html.replace(/local-asset:\/\//g, `${resolvedDir}documents/images/`);
}
