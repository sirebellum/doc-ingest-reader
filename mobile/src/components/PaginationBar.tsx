export interface PaginationBarProps {
  currentChapterTitle: string;
  prevChapterTitle?: string;
  nextChapterTitle?: string;
  onNavigate: (direction: 'prev' | 'next') => void;
}

/**
 * Sticky Pagination Bar providing rapid traversal shortcuts across neighboring sections.
 */
export function PaginationBar({
  currentChapterTitle,
  prevChapterTitle,
  nextChapterTitle,
  onNavigate,
}: PaginationBarProps) {
  const displayString = [
    prevChapterTitle ? `< ${prevChapterTitle}` : '',
    `[${currentChapterTitle}]`,
    nextChapterTitle ? `${nextChapterTitle} >` : '',
  ]
    .filter(Boolean)
    .join('   ');

  return {
    displayString,
    canGoPrev: !!prevChapterTitle,
    canGoNext: !!nextChapterTitle,
    navigatePrev: () => prevChapterTitle && onNavigate('prev'),
    navigateNext: () => nextChapterTitle && onNavigate('next'),
  };
}
