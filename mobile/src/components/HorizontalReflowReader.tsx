import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { FlatList, View, StyleSheet, Dimensions, LayoutChangeEvent, ActivityIndicator } from 'react-native';
import { BlockCell } from './BlockCell';
import type { Block, Annotation } from './BlockCell';
import { TypographyConfig, ViewportDimensions, ChapterPage, PageSegment, paginateBlocks } from '../database/pagination';
import { getPlainTextFromAST } from '../utils/ast';

export interface HorizontalReflowReaderProps {
  initialSectionId: string;
  blocks: Block[];
  annotations?: Annotation[];
  typography: TypographyConfig;
  onLoadAdjacentSection: (sectionId: string, direction: 'prev' | 'next') => Promise<void>;
  onPressBlock?: (block: Block, annotations: Annotation[]) => void;
  nextSectionId?: string;
  prevSectionId?: string;
  isLoading?: boolean;
  dbInstance?: any;
  onPageChange?: (currentPage: number, totalPages: number) => void;
}

/**
 * Reconstructs block AST by slicing plain text at the specified offsets and wrapping in a paragraph AST node.
 */
export function sliceXhtmlContent(block: Block, startOffset: number, endOffset: number): Block {
  const plainText = getPlainTextFromAST(block.content);
  const slicedText = plainText.substring(startOffset, endOffset);

  const ast = {
    type: 'paragraph',
    children: [{
      type: 'text',
      text: slicedText,
      bold: null,
      italic: null,
      code: null
    }]
  };

  return {
    ...block,
    content: JSON.stringify(ast)
  };
}

/**
 * Translates and clips annotation character offsets so they align perfectly on the sliced page layout.
 */
export function getRelativeAnnotationsForSegment(
  segment: PageSegment,
  annotations: Annotation[],
  block: Block
): Annotation[] {
  const blockAnnotations = annotations.filter(ann => ann.block_id === block.id);
  const plainText = getPlainTextFromAST(block.content);

  return blockAnnotations.map(ann => {
    let offset = -1;
    if (ann.anchor_metadata) {
      try {
        const meta = JSON.parse(ann.anchor_metadata);
        if (typeof meta.offset === 'number') {
          offset = meta.offset;
        }
      } catch {}
    }

    if (offset === -1 && ann.highlighted_text) {
      offset = plainText.indexOf(ann.highlighted_text);
    }

    if (offset !== -1) {
      const annLength = ann.highlighted_text ? ann.highlighted_text.length : 0;
      const annEnd = offset + annLength;

      // Check if highlight overlaps with the current segment character range
      const overlaps = Math.max(offset, segment.startOffset) < Math.min(annEnd, segment.endOffset);
      if (!overlaps) return null;

      // Translate offsets relative to segment slice start
      const relativeStart = Math.max(0, offset - segment.startOffset);
      const relativeText = ann.highlighted_text
        ? ann.highlighted_text.substring(
            Math.max(0, segment.startOffset - offset),
            Math.min(annLength, segment.endOffset - offset)
          )
        : null;

      let newMetadata = ann.anchor_metadata;
      if (ann.anchor_metadata) {
        try {
          const meta = JSON.parse(ann.anchor_metadata);
          newMetadata = JSON.stringify({
            ...meta,
            offset: relativeStart
          });
        } catch {}
      } else {
        newMetadata = JSON.stringify({
          prefix: '',
          suffix: '',
          offset: relativeStart
        });
      }

      return {
        ...ann,
        highlighted_text: relativeText,
        anchor_metadata: newMetadata
      };
    }

    return ann;
  }).filter(Boolean) as Annotation[];
}

/**
 * Highly optimized, horizontal reflow paginated reader.
 * Uses FlatList for memory-efficient cell recycling and page pre-fetching.
 */
export function HorizontalReflowReader({
  initialSectionId,
  blocks,
  annotations = [],
  typography,
  onLoadAdjacentSection,
  onPressBlock,
  nextSectionId,
  prevSectionId,
  isLoading = false,
  dbInstance,
  onPageChange,
}: HorizontalReflowReaderProps) {
  const [viewport, setViewport] = useState<ViewportDimensions>({
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  });
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);

  // Re-calculate pages dynamically on-mount, on-resize, or typography change
  const pages = useMemo(() => {
    if (!blocks || blocks.length === 0) return [];
    return paginateBlocks(blocks, viewport, typography, dbInstance);
  }, [blocks, viewport, typography, dbInstance]);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setViewport({ width, height });
    }
  }, []);

  const handlePageChange = useCallback((index: number) => {
    if (index >= 0 && index < pages.length) {
      setCurrentPageIndex(index);
      if (onPageChange) {
        onPageChange(index, pages.length);
      }
    }
  }, [onPageChange, pages.length]);

  // High-performance page and chapter prefetching triggers
  useEffect(() => {
    if (pages.length === 0) return;
    if (prevSectionId && currentPageIndex === 0) {
      onLoadAdjacentSection(prevSectionId, 'prev');
    }
    if (nextSectionId && currentPageIndex === pages.length - 1) {
      onLoadAdjacentSection(nextSectionId, 'next');
    }
  }, [currentPageIndex, pages.length, nextSectionId, prevSectionId]);

  const renderPage = useCallback(({ item: page }: { item: ChapterPage }) => {
    return (
      <View 
        style={[styles.pageContainer, { width: viewport.width, height: viewport.height }]}
        testID={`reflow-page-${page.pageIndex}`}
      >
        {page.segments.map((segment, index) => {
          const block = blocks.find(b => b.id === segment.blockId);
          if (!block) return null;

          // Reconstruct XHTML for partial splits, wrapping text inside outer tags
          const slicedBlock = segment.isPartial
            ? sliceXhtmlContent(block, segment.startOffset, segment.endOffset)
            : block;

          // Re-anchor annotations and highlights relatively
          const relativeAnnotations = getRelativeAnnotationsForSegment(segment, annotations, block);

          return (
            <BlockCell
              key={`${segment.blockId}-${index}`}
              block={slicedBlock}
              annotations={relativeAnnotations}
              onPressBlock={onPressBlock}
            />
          );
        })}
      </View>
    );
  }, [blocks, annotations, viewport, onPressBlock]);

  const handleScroll = useCallback((e: any) => {
    const contentOffset = e.nativeEvent.contentOffset.x;
    const layoutWidth = e.nativeEvent.layoutMeasurement.width || viewport.width;
    if (layoutWidth > 0) {
      const index = Math.round(contentOffset / layoutWidth);
      handlePageChange(index);
    }
  }, [viewport.width, handlePageChange]);

  return (
    <View style={styles.container} onLayout={handleLayout} testID="horizontal-reflow-reader-container">
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="hsl(210, 100%, 75%)" />
        </View>
      )}

      <FlatList
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        data={pages}
        keyExtractor={(item) => String(item.pageIndex)}
        renderItem={renderPage}
        windowSize={3}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyContainer} testID="reflow-empty">
              <ActivityIndicator size="small" color="hsl(0, 0%, 50%)" style={{ marginBottom: 12 }} />
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'hsl(220, 15%, 8%)',
  },
  pageContainer: {
    paddingVertical: 16,
    paddingHorizontal: 8,
    justifyContent: 'flex-start',
    alignItems: 'stretch',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(18, 18, 18, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
});
