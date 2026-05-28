import { fuzzyReAnchor, SearchableBlock, AnchorMetadata } from '../anchoring';

describe('W3C Fuzzy Re-Anchoring Engine', () => {
  const blocks: SearchableBlock[] = [
    {
      id: 'block-1',
      text: 'This is the introductory chapter describing database synchronization mechanisms.',
    },
    {
      id: 'block-2',
      text: 'To avoid search matching pollution, the application maintains a virtual table using FTS5.',
    },
  ];

  it('should resolve simple exact substring matches', () => {
    const context: AnchorMetadata = { prefix: '', suffix: '', offset: 0 };
    const res = fuzzyReAnchor('search matching pollution', context, blocks);

    expect(res).not.toBeNull();
    expect(res!.blockId).toBe('block-2');
    expect(res!.startOffset).toBe(9);
    expect(res!.endOffset).toBe(34);
    expect(res!.confidence).toBe(0.5); // Base exact confidence score
  });

  it('should boost confidence scores if surrounding context prefixes and suffixes align', () => {
    const context: AnchorMetadata = {
      prefix: 'To avoid ',
      suffix: ', the application',
      offset: 0,
    };
    const res = fuzzyReAnchor('search matching pollution', context, blocks);

    expect(res).not.toBeNull();
    expect(res!.confidence).toBe(1.0); // Boosted score (0.5 + 0.25 + 0.25)
  });

  it('should fall back to prefix match coordinates if direct exact highlighted text substring fails', () => {
    const context: AnchorMetadata = {
      prefix: 'introductory chapter ',
      suffix: '',
      offset: 0,
    };
    // Text differs slightly (e.g. edition mismatch), but prefix exists!
    const res = fuzzyReAnchor('DESCRIPING DATABASES', context, blocks);

    expect(res).not.toBeNull();
    expect(res!.blockId).toBe('block-1');
    expect(res!.confidence).toBe(0.4); // Fallback confidence
  });
});
