jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn().mockReturnValue({
    execSync: jest.fn(),
  }),
}));

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock-sandbox/',
}));

jest.mock('react-native-render-html', () => 'RenderHTML');

import Database from 'better-sqlite3';
import { INITIALIZE_DATABASE_SCHEMA } from '../schema';
import { 
  Block, 
  Annotation 
} from '../../components/BlockCell';
import { 
  TypographyConfig, 
  ViewportDimensions, 
  estimateDynamicBlockHeight, 
  getOrCacheDynamicBlockHeight, 
  evictLayoutHeightCache, 
  paginateBlocks 
} from '../pagination';
import { 
  sliceXhtmlContent, 
  getRelativeAnnotationsForSegment 
} from '../../components/HorizontalReflowReader';

import { getPlainTextFromAST } from '../../utils/ast';

describe('Phase 14 Fluid Reflowable Pagination Engine', () => {
  let db: Database.Database;

  const block1: Block = {
    id: 'b-1',
    section_id: 'sec-1',
    document_id: 'doc-1',
    block_type: 'heading',
    content: JSON.stringify({
      type: 'heading',
      level: 2,
      children: [{ type: 'text', text: 'Chapter 1: Fluid Reflow', bold: null, italic: null, code: null }]
    }),
    sort_order: 1,
  };

  const block2: Block = {
    id: 'b-2',
    section_id: 'sec-1',
    document_id: 'doc-1',
    block_type: 'paragraph',
    content: JSON.stringify({
      type: 'paragraph',
      children: [{ type: 'text', text: 'Standard reflow paginates chapters into pages dynamically on-mount.', bold: null, italic: null, code: null }]
    }),
    sort_order: 2,
  };

  const block3: Block = {
    id: 'b-3',
    section_id: 'sec-1',
    document_id: 'doc-1',
    block_type: 'paragraph',
    content: JSON.stringify({
      type: 'paragraph',
      children: [{ type: 'text', text: 'This is an extremely long paragraph containing multiple lines of characters and words designed to check if pagination splits it cleanly across page boundaries at space word transitions rather than middle of words. '.repeat(4), bold: null, italic: null, code: null }]
    }),
    sort_order: 3,
  };

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(INITIALIZE_DATABASE_SCHEMA);

    // Seed required tables for foreign key cascades
    db.prepare("INSERT INTO corpora (id, name) VALUES ('corp-1', 'Main Corpus');").run();
    db.prepare(`
      INSERT INTO documents (id, corpus_id, title, author, sha256_hash, storage_path) 
      VALUES ('doc-1', 'corp-1', 'Test Book', 'Test Author', 'sha256_mock', '/path.pdf');
    `).run();
    db.prepare("INSERT INTO sections (id, document_id, title, sort_order) VALUES ('sec-1', 'doc-1', 'Ch 1', 1);").run();
  });

  afterEach(() => {
    db.close();
  });

  describe('Dynamic Height Estimation Rules', () => {
    const viewport: ViewportDimensions = { width: 375, height: 667 };
    const typography: TypographyConfig = { fontSize: 16, lineHeight: 24 };

    it('should estimate a valid height for heading blocks', () => {
      const height = estimateDynamicBlockHeight(block1, viewport, typography);
      expect(height).toBeGreaterThan(0);
    });

    it('should estimate a smaller height for small font sizes', () => {
      const smallHeight = estimateDynamicBlockHeight(block2, viewport, { fontSize: 12, lineHeight: 18 });
      const largeHeight = estimateDynamicBlockHeight(block2, viewport, { fontSize: 24, lineHeight: 36 });
      expect(largeHeight).toBeGreaterThan(smallHeight);
    });

    it('should estimate a smaller height under landscape viewport limits', () => {
      const portrait = estimateDynamicBlockHeight(block3, { width: 320, height: 568 }, typography);
      const landscape = estimateDynamicBlockHeight(block3, { width: 1024, height: 768 }, typography);
      expect(portrait).toBeGreaterThan(landscape);
    });
  });

  describe('SQLite Height Cache & Eviction', () => {
    const viewport: ViewportDimensions = { width: 375, height: 667 };
    const typography: TypographyConfig = { fontSize: 16, lineHeight: 24 };

    beforeEach(() => {
      // Seed blocks to allow layout_height_cache foreign keys
      for (const b of [block1, block2, block3]) {
        db.prepare(`
          INSERT INTO blocks (id, section_id, document_id, block_type, content, sort_order) 
          VALUES (?, ?, ?, ?, ?, ?);
        `).run(b.id, b.section_id, b.document_id, b.block_type, b.content, b.sort_order);
      }
    });

    it('should calculate, write to cache on first call, and retrieve from cache on subsequent calls', () => {
      const height1 = getOrCacheDynamicBlockHeight(db, block1, viewport, typography);
      expect(height1).toBeGreaterThan(0);

      // Verify SQLite row was added
      const row = db.prepare('SELECT estimated_height FROM layout_height_cache WHERE block_id = ?;').get('b-1') as any;
      expect(row).toBeDefined();
      expect(row.estimated_height).toBe(height1);

      // Directly update SQLite cache to test cache hit retrieval
      db.prepare('UPDATE layout_height_cache SET estimated_height = ? WHERE block_id = ?;').run(888, 'b-1');

      const height2 = getOrCacheDynamicBlockHeight(db, block1, viewport, typography);
      expect(height2).toBe(888); // Returns cached value!
    });

    it('should successfully delete all cached entries when evictLayoutHeightCache is called', () => {
      getOrCacheDynamicBlockHeight(db, block1, viewport, typography);
      getOrCacheDynamicBlockHeight(db, block2, viewport, typography);

      let count = db.prepare('SELECT COUNT(*) as count FROM layout_height_cache;').get() as any;
      expect(count.count).toBe(2);

      // Evict cache
      evictLayoutHeightCache(db);

      // Verify entries were cleared
      count = db.prepare('SELECT COUNT(*) as count FROM layout_height_cache;').get() as any;
      expect(count.count).toBe(0);
    });
  });

  describe('Dynamic Reflow Page Splitting & Pagination Mapper', () => {
    it('should partition chapter blocks into pages under portrait phone dimensions', () => {
      const blocks = [block1, block2];
      const viewport: ViewportDimensions = { width: 375, height: 667 };
      const typography: TypographyConfig = { fontSize: 16, lineHeight: 24 };

      const pages = paginateBlocks(blocks, viewport, typography);
      expect(pages.length).toBeGreaterThan(0);
      expect(pages[0].pageIndex).toBe(0);
      expect(pages[0].segments[0].blockId).toBe('b-1');
    });

    it('should split extremely long blocks across multiple pages', () => {
      const blocks = [block3];
      // Set very small viewport height to force pagination splitting
      const viewport: ViewportDimensions = { width: 320, height: 250 };
      const typography: TypographyConfig = { fontSize: 16, lineHeight: 24 };

      const pages = paginateBlocks(blocks, viewport, typography);
      expect(pages.length).toBeGreaterThan(1); // Split into multiple pages!
      expect(pages[0].segments[0].isPartial).toBe(true);
    });

    it('should split blocks at word space boundaries within the split buffer window', () => {
      const blocks = [block3];
      const viewport: ViewportDimensions = { width: 320, height: 250 };
      const typography: TypographyConfig = { fontSize: 16, lineHeight: 24 };

      const pages = paginateBlocks(blocks, viewport, typography);
      const splitOffset = pages[0].segments[0].endOffset;
      const plainText = getPlainTextFromAST(block3.content);
      
      // Verify that the split character is adjacent to a space boundary
      const splitChar = plainText.charAt(splitOffset);
      const prevChar = plainText.charAt(splitOffset - 1);
      const hasSpaceBoundary = splitChar === ' ' || prevChar === ' ';
      expect(hasSpaceBoundary).toBe(true);
    });
  });

  describe('Highlights Anchoring & Offset Translations', () => {
    const block: Block = {
      id: 'b-para',
      section_id: 'sec-1',
      document_id: 'doc-1',
      block_type: 'paragraph',
      content: JSON.stringify({
        type: 'paragraph',
        children: [{ type: 'text', text: 'The database uses structured schemas to save block tokens.', bold: null, italic: null, code: null }]
      }),
      sort_order: 1,
    };

    const annotations: Annotation[] = [
      {
        id: 'ann-1',
        document_id: 'doc-1',
        block_id: 'b-para',
        annotation_type: 'highlight',
        color_code: 'hsl(48, 100%, 65%)',
        highlighted_text: 'structured schemas',
        note_body: 'Critical schema sync notes',
        anchor_metadata: JSON.stringify({ prefix: 'uses ', suffix: ' to save', offset: 18 }),
      },
      {
        id: 'ann-2',
        document_id: 'doc-1',
        block_id: 'b-para',
        annotation_type: 'highlight',
        color_code: 'hsl(180, 100%, 65%)',
        highlighted_text: 'block tokens',
        note_body: 'Tokens notes',
        anchor_metadata: JSON.stringify({ prefix: 'save ', suffix: '.', offset: 45 }),
      }
    ];

    it('should correctly segment block content and wrap partial content in an AST paragraph node', () => {
      const slicedBlock = sliceXhtmlContent(block, 4, 30);
      const ast = JSON.parse(slicedBlock.content);
      expect(ast.type).toBe('paragraph');
      expect(ast.children[0].text).toContain('database uses structured');
    });

    it('should clip and shift annotation character offsets to relative coordinates inside page segment', () => {
      // Slicing from plain text offset 10 to 40
      const segment = {
        blockId: 'b-para',
        startOffset: 10,
        endOffset: 40,
        isPartial: true,
      };

      const relativeAnns = getRelativeAnnotationsForSegment(segment, annotations, block);
      expect(relativeAnns.length).toBe(1); // Only ann-1 falls in this range!
      
      const adjustedAnn = relativeAnns[0];
      expect(adjustedAnn.id).toBe('ann-1');
      
      // Original offset was 18. Relative offset = 18 - 10 = 8!
      const meta = JSON.parse(adjustedAnn.anchor_metadata || '{}');
      expect(meta.offset).toBe(8);
      expect(adjustedAnn.highlighted_text).toBe('structured schemas');
    });

    it('should return empty list if annotations have no overlap with the page segment', () => {
      const segment = {
        blockId: 'b-para',
        startOffset: 0,
        endOffset: 15,
        isPartial: true,
      };

      const relativeAnns = getRelativeAnnotationsForSegment(segment, annotations, block);
      expect(relativeAnns.length).toBe(0);
    });
  });
});
