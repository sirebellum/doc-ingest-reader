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
  // If content is not yet measured, or fits entirely on the screen, do not auto-paginate.
  if (contentHeight === 0 || layoutHeight === 0 || contentHeight <= layoutHeight) {
    return null;
  }

  // Require overscroll to go to previous section to prevent infinite loops on load
  // (since contentOffsetY is exactly 0 when the section first loads).
  if (contentOffsetY < -50 && prevSectionId) {
    return { sectionId: prevSectionId, direction: 'prev' };
  } 
  
  // Proximity trigger for next section (prefetch before hitting the exact bottom)
  const bottomProximity = 100;
  if (contentOffsetY + layoutHeight >= contentHeight - bottomProximity && nextSectionId) {
    return { sectionId: nextSectionId, direction: 'next' };
  }

  return null;
}
