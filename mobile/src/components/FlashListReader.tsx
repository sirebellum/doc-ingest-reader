import { useState, useEffect } from 'react';
import { Dimensions, ScaledSize } from 'react-native';

export interface Block {
  id: string;
  section_id: string;
  content: string;
  block_type: string;
}

export interface FlashListReaderProps {
  initialSectionId: string;
  blocks: Block[];
  onLoadAdjacentSection: (sectionId: string, direction: 'prev' | 'next') => Promise<void>;
  nextSectionId?: string;
  prevSectionId?: string;
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
    const action = getScrollAction(
      contentOffsetY,
      layoutHeight,
      contentHeight,
      props.prevSectionId,
      props.nextSectionId
    );

    if (action) {
      await props.onLoadAdjacentSection(action.sectionId, action.direction);
    }
  };

  return {
    isTablet,
    dimensions,
    handleScrollProximity,
    blocksCount: props.blocks.length,
  };
}
