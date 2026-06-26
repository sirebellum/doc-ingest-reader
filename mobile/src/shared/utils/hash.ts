import crypto from 'react-native-quick-crypto';

export function generateBlockId(documentId: string, sequenceIndex: number, rawTextContent: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(documentId);
  hash.update('\0');
  hash.update(sequenceIndex.toString());
  hash.update('\0');
  hash.update(rawTextContent);
  return `blk_${hash.digest('hex')}`;
}
