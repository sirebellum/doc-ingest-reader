import { generateBlockId } from './hash';

describe('hash generation divergence test', () => {
  it('should generate the exact same hash as the Rust implementation for a known input', () => {
    const docId = 'doc_12345';
    const seqIdx = 1;
    const content = 'Chapter 1';
    
    const hash = generateBlockId(docId, seqIdx, content);
    // This expected hash MUST match the one generated in rust_core/contracts/src/hash.rs test
    expect(hash).toBe('blk_933ca4153e7ae2dd373403dcc5ce48f2832d842d00407044a524f22b510bcf64');
  });
});
