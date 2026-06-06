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
