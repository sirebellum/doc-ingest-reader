import { generateBlockId } from './hash';

describe('hash generation divergence test', () => {
  it('should generate the exact same hash as the Rust implementation for a known input', () => {
    const docId = 'doc_12345';
    const seqIdx = 1;
    const content = 'Chapter 1';
    
    const hash = generateBlockId(docId, seqIdx, content);
    // This expected hash MUST match the one generated in rust_core/contracts/src/hash.rs test
    expect(hash).toBe('blk_195ab081eb5c17d383b16d1f04af5ce3e167f9ed30caec4f83ebc2efd0c75cc8');
  });
});
