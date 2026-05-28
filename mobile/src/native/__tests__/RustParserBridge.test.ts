import { RustParserBridge } from '../RustParserBridge';

describe('RustParserBridge Native Binding Tests', () => {
  beforeEach(() => {
    // Ensure clean state before each test
    delete (global as any).RustParserBridge;
  });

  it('should fall back to simulator mock when global JSI hook is absent', async () => {
    const resString = await RustParserBridge.parsePDFAsync('docs/sample.pdf');
    const parsed = JSON.parse(resString);

    expect(parsed.document_id).toContain('sample');
    expect(parsed.page_number).toBe(1);
    expect(parsed.layout_hints.length).toBe(2);
    expect(parsed.layout_hints[0].font_size).toBe(18);
  });

  it('should trigger the global C++ JSI function directly if it is defined', async () => {
    const mockJsiParse = jest.fn().mockResolvedValue(
      JSON.stringify({
        document_id: 'jsi-defined-id',
        page_number: 42,
        overlap_context: '',
        raw_text: 'Real JSI raw output',
        layout_hints: [],
      })
    );

    // Inject mock JSI object onto global runtime
    (global as any).RustParserBridge = {
      parsePDFAsync: mockJsiParse,
    };

    const resString = await RustParserBridge.parsePDFAsync('docs/real.pdf');
    const parsed = JSON.parse(resString);

    expect(mockJsiParse).toHaveBeenCalledTimes(1);
    expect(mockJsiParse).toHaveBeenCalledWith('docs/real.pdf');
    expect(parsed.document_id).toBe('jsi-defined-id');
    expect(parsed.page_number).toBe(42);
  });
});
