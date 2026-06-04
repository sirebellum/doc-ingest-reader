import React, { useState, useEffect, useRef } from 'react';
import { Dimensions, ScaledSize, StyleSheet, View, ActivityIndicator, Platform } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { BlockCell } from './BlockCell';
import type { Block, Annotation } from './BlockCell';

export type { Block, Annotation };

export interface FlashListReaderProps {
  initialSectionId: string;
  blocks: Block[];
  annotations?: Annotation[];
  onLoadAdjacentSection: (sectionId: string, direction: 'prev' | 'next') => Promise<void>;
  onPressBlock?: (block: Block, annotations: Annotation[]) => void;
  nextSectionId?: string;
  prevSectionId?: string;
  isLoading?: boolean;
  theme?: {
    textColor: string;
    headingColor: string;
    backgroundColor: string;
    borderColor: string;
    blockquoteBackground: string;
    accentColor: string;
    thBackground: string;
  };
  typography?: {
    fontSize: number;
    fontFamily: string;
    lineHeightMultiplier: number;
  };
  onScroll?: () => void;
}

/**
 * Pure function: Evaluates if a given viewport width matches the tablet threshold
 */
export function isTabletWidth(width: number): boolean {
  return width >= 768;
}

/**
 * Pure function: Computes if a scroll offset event triggers a boundary prefetch action
 */
export function getScrollAction(
  contentOffsetY: number,
  layoutHeight: number,
  contentHeight: number,
  prevSectionId?: string,
  nextSectionId?: string
): { sectionId: string; direction: 'prev' | 'next' } | null {
  const scrollThreshold = contentHeight * 0.1; // 10% proximity window

  if (contentOffsetY <= scrollThreshold && prevSectionId) {
    return { sectionId: prevSectionId, direction: 'prev' };
  } else if (contentOffsetY + layoutHeight >= contentHeight - scrollThreshold && nextSectionId) {
    return { sectionId: nextSectionId, direction: 'next' };
  }

  return null;
}

/**
 * Custom hook to manage responsive reading views and dynamic boundaries
 */
export function useFlashListReader(props: FlashListReaderProps) {
  const [dimensions, setDimensions] = useState<ScaledSize>(Dimensions.get('window'));
  const isPrefetching = useRef(false);

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setDimensions(window);
    });
    return () => subscription.remove();
  }, []);

  const isTablet = isTabletWidth(dimensions.width);

  const handleScrollProximity = async (
    contentOffsetY: number,
    layoutHeight: number,
    contentHeight: number
  ) => {
    if (isPrefetching.current) return;

    const action = getScrollAction(
      contentOffsetY,
      layoutHeight,
      contentHeight,
      props.prevSectionId,
      props.nextSectionId
    );

    if (action) {
      isPrefetching.current = true;
      try {
        await props.onLoadAdjacentSection(action.sectionId, action.direction);
      } finally {
        // Allow further prefetches after load is completed
        isPrefetching.current = false;
      }
    }
  };

  return {
    isTablet,
    dimensions,
    handleScrollProximity,
    blocksCount: props.blocks.length,
  };
}

/**
 * High-Performance Recycled Block List.
 * Renders block nodes using Shopify FlashList to achieve 120 FPS scrolling speed on target devices.
 */
export function FlashListReader(props: FlashListReaderProps) {
  const { blocks, annotations = [], onPressBlock, isLoading = false, theme, typography, onScroll } = props;

  if ((Platform.OS as string) === 'web') {
    return (
      <div 
        onScroll={onScroll}
        style={{
          flex: 1,
          height: '100%',
          overflowY: 'auto',
          backgroundColor: theme?.backgroundColor || 'hsl(220, 15%, 8%)',
          padding: '16px 8px',
          userSelect: 'text',
          WebkitUserSelect: 'text',
        }}
        data-testid="flashlist-reader-container"
      >
        {isLoading && (
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(18, 18, 18, 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
            <ActivityIndicator size="large" color="hsl(210, 100%, 75%)" />
          </div>
        )}
        {blocks.map((item) => {
          const blockAnnotations = annotations.filter((ann) => ann.block_id === item.id);
          return (
            <BlockCell
              key={item.id}
              block={item}
              annotations={blockAnnotations}
              onPressBlock={onPressBlock}
              theme={theme}
              typography={typography}
            />
          );
        })}
        {blocks.length === 0 && !isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px' }}>
            <ActivityIndicator size="small" color="hsl(0, 0%, 50%)" style={{ marginBottom: 12 }} />
          </div>
        )}
      </div>
    );
  }

  const { handleScrollProximity } = useFlashListReader(props);
  const flashListRef = useRef<FlashList<Block>>(null);
 
  useEffect(() => {
    if (blocks.length > 0) {
      flashListRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, [props.initialSectionId]);


  const renderItem = ({ item }: { item: Block }) => {
    const blockAnnotations = annotations.filter((ann) => ann.block_id === item.id);
    return (
      <BlockCell
        block={item}
        annotations={blockAnnotations}
        onPressBlock={onPressBlock}
        theme={theme}
        typography={typography}
      />
    );
  };

  const handleScroll = (event: any) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    handleScrollProximity(
      contentOffset.y,
      layoutMeasurement.height,
      contentSize.height
    );
    if (onScroll) {
      onScroll();
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme?.backgroundColor || 'hsl(220, 15%, 8%)' }]} testID="flashlist-reader-container">
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="hsl(210, 100%, 75%)" />
        </View>
      )}
      
      <FlashList
        ref={flashListRef}
        data={blocks}
        renderItem={renderItem}
        estimatedItemSize={120}
        overrideItemLayout={(layout, item) => {
          layout.size = item.estimated_height || 120;
        }}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyContainer} testID="flashlist-empty">
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
  listContent: {
    paddingVertical: 16,
    paddingHorizontal: 8,
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
