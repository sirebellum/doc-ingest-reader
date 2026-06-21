if (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') {
  try {
    require('../../modules/rust-parser-bridge');
  } catch (e) {
    // Ignore native module load errors in non-native environments
  }
}

import type { PageExtraction } from "../../../rust_core/contracts/bindings/PageExtraction";
import type { ExtractedImageMetadata } from "../../../rust_core/contracts/bindings/ExtractedImageMetadata";
import type { LayoutHint } from "../../../rust_core/contracts/bindings/LayoutHint";
import { Platform } from 'react-native';

let ExpoRustParserBridgeModule: any = null;
try {
  const { requireNativeModule } = require('expo-modules-core');
  ExpoRustParserBridgeModule = requireNativeModule('RustParserBridgeModule');
} catch (e) {
  // Ignore
}




export interface NpuConfig {
  useAppleNeuralEngine: boolean;
  useAndroidDspNpu: boolean;
  gpuLayersOffload: number;
  ramLimitBytes: number;
}

export interface HeapStats {
  total_allocated_bytes: number;
  active_context_bytes: number;
  peak_allocated_bytes: number;
  system_memory_limit_bytes: number;
  available_system_ram_bytes: number;
  is_mock?: boolean;
  origin?: string;
}

// Declare global JSI interface for TypeScript
declare global {
  var RustParserBridge: {
    parsePDFAsync(localPath: string): Promise<string>;
    runInferenceAsync(modelPath: string, prompt: string): Promise<string>;
    delineatePageAsync(pageExtractionJson: string, modelPath: string): Promise<string>;
    getHeapStats(): Promise<string>;
    configureNpu(config: NpuConfig): Promise<number>;
    computeSimilarity(vecA: Float32Array, vecB: Float32Array): number;
    computeBatchSimilarities(targetVec: Float32Array, candidateVecs: Float32Array[] | Float32Array): number[];
  } | undefined;
}

/**
 * High-performance C++ JSI Bridge interface for executing Rust Core parser operations.
 * Dynamically falls back to mock responses in development simulator or testing environments
 * where custom native packages are not compiled.
 */
export const RustParserBridge = {
  async parsePDFAsync(localPath: string): Promise<string> {
    let resultString: string;
    if (ExpoRustParserBridgeModule && typeof ExpoRustParserBridgeModule.parsePDFAsync === 'function') {
      resultString = await ExpoRustParserBridgeModule.parsePDFAsync(localPath);
    } else {
      resultString = await RustParserBridge.parsePDFAsyncFallback(localPath);
    }

    // Apply strict bounds constraints / ceilings to protect JS heap and bridge serialization
    try {
      const parsed = JSON.parse(resultString);
      let modified = false;
      if (parsed.layout_hints && parsed.layout_hints.length > 1000) {
        parsed.layout_hints = parsed.layout_hints.slice(0, 1000);
        modified = true;
      }
      if (parsed.raw_text && parsed.raw_text.length > 100000) {
        parsed.raw_text = parsed.raw_text.substring(0, 100000);
        modified = true;
      }
      if (modified) {
        resultString = JSON.stringify(parsed);
      }
    } catch {}

    return resultString;
  },

  async parsePDFAsyncFallback(localPath: string): Promise<string> {
    // Try fetching from local Desktop server if running in Web browser
    if (Platform.OS === 'web') {
      try {
        const res = await fetch('http://localhost:8080/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: localPath, page_number: 1 }),
        });
        if (res.ok) {
          return await res.text();
        }
      } catch (e) {
        console.warn('[RustParserBridge] Local Desktop Server not detected. Falling back to local mock parsing.');
      }
    }

    // Dev/Test Fallback Mock Ingestion
    console.warn(`[RustParserBridge] JSI native module not detected. Using simulated mock/fallback for path: ${localPath}`);
    await new Promise((resolve) => setTimeout(resolve, 50)); // Simulate background work

    const ext = localPath.split('.').pop()?.toLowerCase();
    
    if (ext === 'md' || ext === 'markdown') {
      // TypeScript Markdown Parser Fallback
      let content = '';
      try {
        if (typeof require !== 'undefined') {
          const req = eval('require');
          const fs = req('fs');
          if (fs.existsSync(localPath)) {
            content = fs.readFileSync(localPath, 'utf8');
          }
        }
      } catch {}

      if (!content) {
        content = `# Simulated Markdown\nThis is simulated markdown content.\n\n## Section 1.1\nSome detailed text here.\n`;
      }

      const docId = `doc-${localPath.split('/').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'dummy'}`;
      const sections: any[] = [];
      const blocks: any[] = [];
      const extractedImages: any[] = [];

      const defaultSecId = `sec-${docId}-default`;
      sections.push({
        id: defaultSecId,
        parent_id: null,
        title: 'Default Section',
        depth_level: 1,
        sort_order: 0,
      });

      let currentSectionId = defaultSecId;
      const sectionStack: Array<{ depth: number; id: string }> = [{ depth: 1, id: defaultSecId }];
      
      let blockCounter = 0;
      let sectionCounter = 0;
      let imageCounter = 0;

      let insideCode = false;
      let codeContent: string[] = [];

      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith('```')) {
          if (insideCode) {
            const ast = {
              type: 'code_block',
              code: codeContent.join('\n'),
              language: null,
            };
            const blockId = `block-md-${docId}-${blockCounter++}`;
            blocks.push({
              id: blockId,
              section_id: currentSectionId,
              block_type: 'code',
              content: JSON.stringify(ast),
              sort_order: blockCounter,
              semantic_tags: ['code'],
            });
            codeContent = [];
            insideCode = false;
          } else {
            insideCode = true;
          }
          continue;
        }

        if (insideCode) {
          codeContent.push(lines[i]);
          continue;
        }

        if (!line) continue;

        if (line.startsWith('#')) {
          const depth = line.match(/^#+/)?.[0].length || 0;
          const title = line.substring(depth).trim();
          if (depth > 0) {
            const secId = `sec-md-${docId}-${++sectionCounter}`;
            let parentId: string | null = null;
            
            while (sectionStack.length > 0) {
              const top = sectionStack[sectionStack.length - 1];
              if (top.depth < depth) {
                parentId = top.id;
                break;
              }
              sectionStack.pop();
            }

            sections.push({
              id: secId,
              parent_id: parentId,
              title,
              depth_level: depth,
              sort_order: sectionCounter,
            });

            sectionStack.push({ depth, id: secId });
            currentSectionId = secId;

            const ast = {
              type: 'heading',
              level: depth,
              children: [{ type: 'text', text: title, bold: null, italic: null, code: null }]
            };
            const blockId = `block-md-${docId}-${blockCounter++}`;
            blocks.push({
              id: blockId,
              section_id: currentSectionId,
              block_type: 'heading',
              content: JSON.stringify(ast),
              sort_order: blockCounter,
              semantic_tags: ['heading'],
            });
            continue;
          }
        }

        if (line.startsWith('>')) {
          const text = line.substring(1).trim();
          const ast = {
            type: 'quote',
            children: [{ type: 'text', text, bold: null, italic: null, code: null }]
          };
          const blockId = `block-md-${docId}-${blockCounter++}`;
          blocks.push({
            id: blockId,
            section_id: currentSectionId,
            block_type: 'quote',
            content: JSON.stringify(ast),
            sort_order: blockCounter,
            semantic_tags: ['quote'],
          });
          continue;
        }

        if (line.startsWith('![') && line.includes('](')) {
          const altMatch = line.match(/!\[(.*?)\]\((.*?)\)/);
          if (altMatch) {
            const alt = altMatch[1];
            const src = altMatch[2];
            const imageId = `img-md-${++imageCounter}`;
            const hash = `hash-${src.replace(/[^a-zA-Z0-9]/g, '')}`;
            const localUri = `local-asset://${hash}_${imageId}.png`;

            extractedImages.push({
              image_id: imageId,
              sha256_hash: hash,
              bounding_box: [0, 0, 100, 100],
              page_width: 612,
              page_height: 792,
              local_uri: localUri,
            });

            const ast = {
              type: 'image',
              src: localUri,
              alt: alt || null,
              caption: null
            };
            const blockId = `block-md-${docId}-${blockCounter++}`;
            blocks.push({
              id: blockId,
              section_id: currentSectionId,
              block_type: 'image',
              content: JSON.stringify(ast),
              sort_order: blockCounter,
              semantic_tags: ['image'],
            });
            continue;
          }
        }

        if (line.startsWith('- ') || line.startsWith('* ')) {
          const text = line.substring(2).trim();
          const ast = {
            type: 'list',
            ordered: false,
            items: [{ children: [{ type: 'text', text, bold: null, italic: null, code: null }] }]
          };
          const blockId = `block-md-${docId}-${blockCounter++}`;
          blocks.push({
            id: blockId,
            section_id: currentSectionId,
            block_type: 'paragraph',
            content: JSON.stringify(ast),
            sort_order: blockCounter,
            semantic_tags: ['list'],
          });
          continue;
        }

        const ast = {
          type: 'paragraph',
          children: [{ type: 'text', text: line, bold: null, italic: null, code: null }]
        };
        const blockId = `block-md-${docId}-${blockCounter++}`;
        blocks.push({
          id: blockId,
          section_id: currentSectionId,
          block_type: 'paragraph',
          content: JSON.stringify(ast),
          sort_order: blockCounter,
          semantic_tags: [],
        });
      }

      return JSON.stringify({
        document_id: docId,
        source_type: 'markdown',
        title: 'Markdown Document',
        author: undefined,
        sections,
        blocks,
        extracted_images: extractedImages,
        is_mock: true,
        origin: 'synthetic_simulation_stub',
      });
    }

    if (ext === 'html' || ext === 'htm') {
      // TypeScript HTML Parser Fallback
      let content = '';
      try {
        if (typeof require !== 'undefined') {
          const req = eval('require');
          const fs = req('fs');
          if (fs.existsSync(localPath)) {
            content = fs.readFileSync(localPath, 'utf8');
          }
        }
      } catch {}

      if (!content) {
        content = `<!DOCTYPE html><html><body><h1>Simulated HTML</h1><p>Paragraph content.</p></body></html>`;
      }

      const docId = `doc-${localPath.split('/').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'dummy'}`;
      const sections: any[] = [];
      const blocks: any[] = [];
      const extractedImages: any[] = [];

      const defaultSecId = `sec-${docId}-default`;
      sections.push({
        id: defaultSecId,
        parent_id: null,
        title: 'Default Section',
        depth_level: 1,
        sort_order: 0,
      });

      let currentSectionId = defaultSecId;
      let sectionCounter = 0;
      let blockCounter = 0;
      let imageCounter = 0;

      const tagRegex = /<h([1-6])[\s\S]*?>([\s\S]*?)<\/h\1>|<p[\s\S]*?>([\s\S]*?)<\/p>|<blockquote[\s\S]*?>([\s\S]*?)<\/blockquote>|<table[\s\S]*?>([\s\S]*?)<\/table>|<img[\s\S]*?>/gi;
      let match;
      while ((match = tagRegex.exec(content)) !== null) {
        const fullTag = match[0];
        const hLevel = match[1];
        const hText = match[2];
        const pText = match[3];
        const qText = match[4];
        const tText = match[5];

        if (hLevel && hText) {
          const title = hText.replace(/<[^>]*>/g, '').trim();
          const depth = parseInt(hLevel, 10);
          const secId = `sec-html-${docId}-${++sectionCounter}`;
          sections.push({
            id: secId,
            parent_id: null,
            title,
            depth_level: depth,
            sort_order: sectionCounter,
          });
          currentSectionId = secId;

          const ast = {
            type: 'heading',
            level: depth,
            children: [{ type: 'text', text: title, bold: null, italic: null, code: null }]
          };
          const blockId = `block-html-${docId}-${blockCounter++}`;
          blocks.push({
            id: blockId,
            section_id: currentSectionId,
            block_type: 'heading',
            content: JSON.stringify(ast),
            sort_order: blockCounter,
            semantic_tags: ['heading'],
          });
        } else if (pText) {
          const text = pText.trim();
          const ast = {
            type: 'paragraph',
            children: [{ type: 'text', text, bold: null, italic: null, code: null }]
          };
          const blockId = `block-html-${docId}-${blockCounter++}`;
          blocks.push({
            id: blockId,
            section_id: currentSectionId,
            block_type: 'paragraph',
            content: JSON.stringify(ast),
            sort_order: blockCounter,
            semantic_tags: [],
          });
        } else if (qText) {
          const text = qText.trim();
          const ast = {
            type: 'quote',
            children: [{ type: 'text', text, bold: null, italic: null, code: null }]
          };
          const blockId = `block-html-${docId}-${blockCounter++}`;
          blocks.push({
            id: blockId,
            section_id: currentSectionId,
            block_type: 'quote',
            content: JSON.stringify(ast),
            sort_order: blockCounter,
            semantic_tags: ['quote'],
          });
        } else if (tText) {
          const text = tText.trim();
          const ast = {
            type: 'table',
            rows: [{
              cells: [
                { children: [{ type: 'text', text: 'Cell 1', bold: null, italic: null, code: null }] },
                { children: [{ type: 'text', text: 'Cell 2', bold: null, italic: null, code: null }] }
              ]
            }]
          };
          const blockId = `block-html-${docId}-${blockCounter++}`;
          blocks.push({
            id: blockId,
            section_id: currentSectionId,
            block_type: 'table',
            content: JSON.stringify(ast),
            sort_order: blockCounter,
            semantic_tags: ['table'],
          });
        } else if (fullTag.toLowerCase().startsWith('<img')) {
          const srcMatch = fullTag.match(/src=["'](.*?)["']/i);
          const altMatch = fullTag.match(/alt=["'](.*?)["']/i);
          const src = srcMatch ? srcMatch[1] : 'unknown';
          const alt = altMatch ? altMatch[1] : '';

          const imageId = `img-html-${++imageCounter}`;
          const hash = `hash-${src.replace(/[^a-zA-Z0-9]/g, '')}`;
          const localUri = `local-asset://${hash}_${imageId}.png`;

          extractedImages.push({
            image_id: imageId,
            sha256_hash: hash,
            bounding_box: [0, 0, 100, 100],
            page_width: 612,
            page_height: 792,
            local_uri: localUri,
          });

          const ast = {
            type: 'image',
            src: localUri,
            alt: alt || null,
            caption: null
          };
          const blockId = `block-html-${docId}-${blockCounter++}`;
          blocks.push({
            id: blockId,
            section_id: currentSectionId,
            block_type: 'image',
            content: JSON.stringify(ast),
            sort_order: blockCounter,
            semantic_tags: ['image'],
          });
        }
      }

      if (blocks.length === 0) {
        const ast = {
          type: 'paragraph',
          children: [{ type: 'text', text: 'HTML fallback block content', bold: null, italic: null, code: null }]
        };
        const blockId = `block-html-${docId}-${blockCounter++}`;
        blocks.push({
          id: blockId,
          section_id: currentSectionId,
          block_type: 'paragraph',
          content: JSON.stringify(ast),
          sort_order: blockCounter,
          semantic_tags: [],
        });
      }

      return JSON.stringify({
        document_id: docId,
        source_type: 'html',
        title: 'HTML Document',
        author: undefined,
        sections,
        blocks,
        extracted_images: extractedImages,
        is_mock: true,
        origin: 'synthetic_simulation_stub',
      });
    }

    if (ext === 'epub') {
      // TypeScript EPUB Parser Fallback
      const docId = `doc-${localPath.split('/').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'dummy'}`;
      const sections: any[] = [];
      const blocks: any[] = [];
      const extractedImages: any[] = [];

      const chapters = [
        { title: 'Introduction', content: 'This is the introduction chapter of the EPUB book. XHTML elements are parsed sequentially.' },
        { title: 'Chapter 1: Native Bridges', content: 'This chapter explains native JSI hooks, NPU neural shaders, and memory heap diagnostics.' },
        { title: 'Chapter 2: Offline Databases', content: 'Detailed study of SQLite relational schemas, FTS5 virtual tables, and conflict merging.' }
      ];

      for (let idx = 0; idx < chapters.length; idx++) {
        const chapterNum = idx + 1;
        const secId = `sec-epub-${docId}-${chapterNum}`;
        sections.push({
          id: secId,
          parent_id: null,
          title: chapters[idx].title,
          depth_level: 1,
          sort_order: chapterNum,
        });

        const headingAst = {
          type: 'heading',
          level: 2,
          children: [{ type: 'text', text: chapters[idx].title, bold: null, italic: null, code: null }]
        };
        const headingBlockId = `block-epub-${docId}-${chapterNum}-h`;
        blocks.push({
          id: headingBlockId,
          section_id: secId,
          block_type: 'heading',
          content: JSON.stringify(headingAst),
          sort_order: idx * 10,
          semantic_tags: ['heading', 'chapter'],
        });

        const contentAst = {
          type: 'paragraph',
          children: [{ type: 'text', text: chapters[idx].content, bold: null, italic: null, code: null }]
        };
        const contentBlockId = `block-epub-${docId}-${chapterNum}-p`;
        blocks.push({
          id: contentBlockId,
          section_id: secId,
          block_type: 'paragraph',
          content: JSON.stringify(contentAst),
          sort_order: idx * 10 + 1,
          semantic_tags: [],
        });
      }

      return JSON.stringify({
        document_id: docId,
        source_type: 'epub',
        title: 'EPUB Document',
        author: undefined,
        sections,
        blocks,
        extracted_images: extractedImages,
        is_mock: true,
        origin: 'synthetic_simulation_stub',
      });
    }

    const mockResult: PageExtraction & { is_mock?: boolean; origin?: string } = {
      document_id: `doc-${localPath.split('/').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'dummy'}`,
      page_number: 1,
      overlap_context: 'synthetic_simulation_stub_overlap_context',
      raw_text: 'synthetic_simulation_stub: Simulated raw PDF page text containing layout structures, headings, paragraphs, and list elements. [Image: local-asset://e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855_img-p1-1.png]',
      layout_hints: [
        {
          bounding_box: [10, 20, 200, 45],
          font_size: 18,
          text_snippet: 'synthetic_simulation_stub: Chapter 1: Getting Started',
        },
        {
          bounding_box: [10, 60, 450, 120],
          font_size: 11,
          text_snippet: 'synthetic_simulation_stub: This is the main body paragraph showing the structural details of the system.',
        },
      ],
      extracted_images: [
        {
          image_id: 'img-p1-1',
          sha256_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          bounding_box: [10, 150, 200, 300],
          page_width: 612,
          page_height: 792,
          local_uri: 'local-asset://e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855_img-p1-1.png',
        }
      ],
      is_mock: true,
      origin: 'synthetic_simulation_stub',
    };

    return JSON.stringify(mockResult);
  },

  async runInferenceAsync(modelPath: string, prompt: string): Promise<string> {
    if (ExpoRustParserBridgeModule && typeof ExpoRustParserBridgeModule.runInferenceAsync === 'function') {
      return ExpoRustParserBridgeModule.runInferenceAsync(modelPath, prompt);
    }

    // Try fetching from local Desktop server if running in Web browser
    if (Platform.OS === 'web') {
      try {
        const res = await fetch('http://localhost:8080/inference', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model_path: modelPath, prompt }),
        });
        if (res.ok) {
          return await res.text();
        }
      } catch (e) {
        console.warn('[RustParserBridge] Local Desktop Server not detected. Falling back to local mock inference.');
      }
    }

    console.warn(`[RustParserBridge] JSI native module not detected. Using simulated mock inference for path: ${modelPath}`);
    await new Promise((resolve) => setTimeout(resolve, 50)); // Simulate background work

    // Mock local inference output matching LLMStructuringOutput format
    const mockOutput = {
      blocks: [
        {
          block_type: 'heading',
          content: {
            type: 'heading',
            level: 2,
            children: [{ type: 'text', text: 'synthetic_simulation_stub: Chapter 1: Local Inference', bold: null, italic: null, code: null }]
          },
          hyperlink_targets: [],
          semantic_tags: ['offline', 'llama', 'local'],
        },
        {
          block_type: 'paragraph',
          content: {
            type: 'paragraph',
            children: [{ type: 'text', text: 'synthetic_simulation_stub: This is standard layout text processed offline through dynamic on-device llama.cpp neural shaders.', bold: null, italic: null, code: null }]
          },
          hyperlink_targets: [],
          semantic_tags: ['npu', 'dsp'],
        },
      ],
      is_mock: true,
      origin: 'synthetic_simulation_stub',
    };

    return JSON.stringify(mockOutput);
  },

  async delineatePageAsync(pageExtractionJson: string, modelPath: string): Promise<string> {
    if (ExpoRustParserBridgeModule && typeof ExpoRustParserBridgeModule.delineatePageAsync === 'function') {
      return ExpoRustParserBridgeModule.delineatePageAsync(pageExtractionJson, modelPath);
    }

    if (Platform.OS === 'web') {
      try {
        const res = await fetch('http://localhost:8080/delineate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page_extraction: JSON.parse(pageExtractionJson), model_path: modelPath }),
        });
        if (res.ok) {
          return await res.text();
        }
      } catch (e) {
        console.warn('[RustParserBridge] Local Desktop Server not detected. Falling back to local mock delineation.');
      }
    }

    console.warn(`[RustParserBridge] JSI native module not detected. Using simulated mock delineation.`);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const extraction = JSON.parse(pageExtractionJson);
    const docId = extraction.document_id;
    const pageNum = extraction.page_number;

    const sections: any[] = [];
    const blocks: any[] = [];

    const defaultSecId = `sec-${docId}-default`;
    let currentSectionId = defaultSecId;
    let sectionSortOrder = pageNum * 100;

    const sectionId = `sec-${docId}-${pageNum}-mock`;
    sections.push({
      id: sectionId,
      parent_id: null,
      title: `synthetic_simulation_stub: Mock Chapter ${pageNum}`,
      depth_level: 1,
      sort_order: sectionSortOrder++,
    });
    currentSectionId = sectionId;

    blocks.push({
      id: `block-chunk-job-${docId}-${pageNum}-heading`,
      section_id: currentSectionId,
      block_type: 'heading',
      content: JSON.stringify({
        type: 'heading',
        level: 2,
        children: [{ type: 'text', text: `synthetic_simulation_stub: Mock Chapter ${pageNum}`, bold: null, italic: null, code: null }]
      }),
      sort_order: 0,
      semantic_tags: ['offline', 'llama', 'local'],
    });

    blocks.push({
      id: `block-chunk-job-${docId}-${pageNum}-p`,
      section_id: currentSectionId,
      block_type: 'paragraph',
      content: JSON.stringify({
        type: 'paragraph',
        children: [{ type: 'text', text: `synthetic_simulation_stub: This is a simulated paragraph containing ${extraction.raw_text.substring(0, 30)}...`, bold: null, italic: null, code: null }]
      }),
      sort_order: 1,
      semantic_tags: ['npu', 'dsp'],
    });

    return JSON.stringify({
      document_id: docId,
      source_type: 'pdf',
      title: 'PDF Page',
      author: undefined,
      sections,
      blocks,
      extracted_images: extraction.extracted_images || [],
      is_mock: true,
      origin: 'synthetic_simulation_stub',
    });
  },

  async getHeapStats(): Promise<string> {
    if (ExpoRustParserBridgeModule && typeof ExpoRustParserBridgeModule.getHeapStats === 'function') {
      return ExpoRustParserBridgeModule.getHeapStats();
    }

    // Dev/Test Fallback Mock Profiler
    const mockStats: HeapStats = {
      total_allocated_bytes: 350_000_000,
      active_context_bytes: 250_000_000,
      peak_allocated_bytes: 400_000_000,
      system_memory_limit_bytes: 1_800_000_000,
      available_system_ram_bytes: 1_200_000_000,
      is_mock: true,
      origin: 'synthetic_simulation_stub',
    };

    return JSON.stringify(mockStats);
  },

  async configureNpu(config: NpuConfig): Promise<number> {
    if (ExpoRustParserBridgeModule && typeof ExpoRustParserBridgeModule.configureNpu === 'function') {
      return ExpoRustParserBridgeModule.configureNpu(JSON.stringify(config));
    }

    console.log('[RustParserBridge] Configuring NPU settings on developer mock:', config);
    return 0; // Success
  },

  computeSimilarity(vecA: Float32Array, vecB: Float32Array): number {
    if (global.RustParserBridge && typeof global.RustParserBridge.computeSimilarity === 'function') {
      return global.RustParserBridge.computeSimilarity(vecA, vecB);
    }

    // Fallback JS Cosine Similarity implementation
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    const normProduct = Math.sqrt(normA) * Math.sqrt(normB);
    return normProduct > 0 ? dotProduct / normProduct : 0;
  },

  computeBatchSimilarities(targetVec: Float32Array, candidateVecs: Float32Array[]): number[] {
    if (global.RustParserBridge && typeof global.RustParserBridge.computeBatchSimilarities === 'function') {
      const numCandidates = candidateVecs.length;
      if (numCandidates === 0) return [];
      const dim = targetVec.length;
      const flatCandidates = new Float32Array(numCandidates * dim);
      for (let i = 0; i < numCandidates; i++) {
        flatCandidates.set(candidateVecs[i], i * dim);
      }
      return global.RustParserBridge.computeBatchSimilarities(targetVec, flatCandidates);
    }

    // Fallback JS Batch Cosine Similarity implementation
    return candidateVecs.map(candidateVec => this.computeSimilarity(targetVec, candidateVec));
  },
};
