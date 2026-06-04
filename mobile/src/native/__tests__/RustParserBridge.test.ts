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
    } as any;

    const resString = await RustParserBridge.parsePDFAsync('docs/real.pdf');
    const parsed = JSON.parse(resString);

    expect(mockJsiParse).toHaveBeenCalledTimes(1);
    expect(mockJsiParse).toHaveBeenCalledWith('docs/real.pdf');
    expect(parsed.document_id).toBe('jsi-defined-id');
    expect(parsed.page_number).toBe(42);
  });

  it('should fall back to simulator mock when global JSI hook is absent for runInferenceAsync', async () => {
    const resString = await RustParserBridge.runInferenceAsync('models/custom.gguf', 'What is local inference?');
    const parsed = JSON.parse(resString);

    expect(parsed.blocks).toBeDefined();
    expect(parsed.blocks.length).toBe(2);
    expect(parsed.blocks[0].block_type).toBe('heading');
    expect(parsed.blocks[0].content.children[0].text).toContain('Local Inference');
    expect(parsed.blocks[1].semantic_tags).toContain('npu');
  });

  it('should trigger the global C++ JSI function directly for runInferenceAsync if defined', async () => {
    const mockJsiInference = jest.fn().mockResolvedValue(
      JSON.stringify({
        blocks: [
          {
            block_type: 'paragraph',
            content: {
              type: 'paragraph',
              children: [{ type: 'text', text: 'Mocked JSI direct response.', bold: null, italic: null, code: null }]
            },
            hyperlink_targets: [],
            semantic_tags: ['jsi']
          }
        ]
      })
    );

    // Inject mock JSI object onto global runtime
    (global as any).RustParserBridge = {
      runInferenceAsync: mockJsiInference,
    } as any;

    const resString = await RustParserBridge.runInferenceAsync('models/real.gguf', 'Real prompt');
    const parsed = JSON.parse(resString);

    expect(mockJsiInference).toHaveBeenCalledTimes(1);
    expect(mockJsiInference).toHaveBeenCalledWith('models/real.gguf', 'Real prompt');
    expect(parsed.blocks.length).toBe(1);
    expect(parsed.blocks[0].block_type).toBe('paragraph');
    expect(parsed.blocks[0].content.children[0].text).toBe('Mocked JSI direct response.');
  });

  it('should fall back to simulator mock for getHeapStats when JSI is absent', async () => {
    const resString = await RustParserBridge.getHeapStats();
    const stats = JSON.parse(resString);

    expect(stats.total_allocated_bytes).toBe(350000000);
    expect(stats.peak_allocated_bytes).toBe(400000000);
    expect(stats.system_memory_limit_bytes).toBe(1800000000);
  });

  it('should trigger direct global JSI getHeapStats when defined', async () => {
    const mockGetHeapStats = jest.fn().mockResolvedValue(
      JSON.stringify({
        total_allocated_bytes: 999,
        active_context_bytes: 888,
        peak_allocated_bytes: 777,
        system_memory_limit_bytes: 666,
        available_system_ram_bytes: 555,
      })
    );

    (global as any).RustParserBridge = {
      getHeapStats: mockGetHeapStats,
    } as any;

    const resString = await RustParserBridge.getHeapStats();
    const stats = JSON.parse(resString);

    expect(mockGetHeapStats).toHaveBeenCalledTimes(1);
    expect(stats.total_allocated_bytes).toBe(999);
  });

  it('should fall back to simulator mock for configureNpu when JSI is absent', async () => {
    const resCode = await RustParserBridge.configureNpu({
      useAppleNeuralEngine: true,
      useAndroidDspNpu: true,
      gpuLayersOffload: 16,
      ramLimitBytes: 1024,
    });

    expect(resCode).toBe(0);
  });

  it('should trigger direct global JSI configureNpu when defined', async () => {
    const mockConfigureNpu = jest.fn().mockResolvedValue(42);

    (global as any).RustParserBridge = {
      configureNpu: mockConfigureNpu,
    } as any;

    const resCode = await RustParserBridge.configureNpu({
      useAppleNeuralEngine: false,
      useAndroidDspNpu: false,
      gpuLayersOffload: 0,
      ramLimitBytes: 0,
    });

    expect(mockConfigureNpu).toHaveBeenCalledTimes(1);
    expect(resCode).toBe(42);
  });
});
