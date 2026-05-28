export interface BoundingBox {
  bounding_box: [number, number, number, number];
  font_size: number;
  text_snippet: string;
}

export interface ExtractedPage {
  document_id: string;
  page_number: number;
  overlap_context: string;
  raw_text: string;
  layout_hints: BoundingBox[];
}

// Declare global JSI interface for TypeScript
declare global {
  var RustParserBridge: {
    parsePDFAsync(localPath: string): Promise<string>;
  } | undefined;
}

/**
 * High-performance C++ JSI Bridge interface for executing Rust Core parser operations.
 * Dynamically falls back to mock responses in development simulator or testing environments
 * where custom native packages are not compiled.
 */
export const RustParserBridge = {
  async parsePDFAsync(localPath: string): Promise<string> {
    if (global.RustParserBridge && typeof global.RustParserBridge.parsePDFAsync === 'function') {
      return global.RustParserBridge.parsePDFAsync(localPath);
    }

    // Dev/Test Fallback Mock Ingestion
    console.warn(`[RustParserBridge] JSI native module not detected. Using simulated mock for path: ${localPath}`);
    await new Promise((resolve) => setTimeout(resolve, 100)); // Simulate background work

    const mockResult: ExtractedPage = {
      document_id: `doc-${localPath.split('/').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'dummy'}`,
      page_number: 1,
      overlap_context: 'Simulated static prefix context from previous segments.',
      raw_text: 'Simulated raw PDF page text containing layout structures, headings, paragraphs, and list elements.',
      layout_hints: [
        {
          bounding_box: [10, 20, 200, 45],
          font_size: 18,
          text_snippet: 'Chapter 1: Getting Started',
        },
        {
          bounding_box: [10, 60, 450, 120],
          font_size: 11,
          text_snippet: 'This is the main body paragraph showing the structural details of the system.',
        },
      ],
    };

    return JSON.stringify(mockResult);
  },
};
