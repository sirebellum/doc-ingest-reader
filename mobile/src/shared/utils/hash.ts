import { createHash } from 'react-native-quick-crypto';

export function generateBlockId(documentId: string, sequenceIndex: number, rawTextContent: string): string {
  const hash = createHash('sha256');
  hash.update(documentId);
  hash.update(sequenceIndex.toString());
  hash.update(rawTextContent);
  return `blk_${hash.digest('hex')}`;
}
