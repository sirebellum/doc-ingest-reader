import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';

export interface PaginationBarProps {
  currentChapterTitle: string;
  prevChapterTitle?: string;
  nextChapterTitle?: string;
  onNavigate: (direction: 'prev' | 'next') => void;
}

/**
 * Pure function: Computes the pagination display string and navigation flags.
 * Retained for backward compatibility with the active test suites.
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

/**
 * Sticky Pagination Bar providing rapid traversal shortcuts across neighboring sections.
 * Beautifully styled using deep slate/charcoal HSL tones and Ice Blue highlighting accents.
 */
export function StickyPaginationBar(props: PaginationBarProps) {
  const { currentChapterTitle, prevChapterTitle, nextChapterTitle, onNavigate } = props;
  const { canGoPrev, canGoNext, navigatePrev, navigateNext } = PaginationBar(props);

  return (
    <View style={styles.container} testID="sticky-pagination-bar">
      {/* Previous Chapter Control */}
      {canGoPrev ? (
        <TouchableOpacity 
          onPress={navigatePrev} 
          style={styles.navButton}
          testID="paginate-prev-button"
        >
          <Text style={styles.navText}>
            ‹ {prevChapterTitle ? (prevChapterTitle.length > 15 ? `${prevChapterTitle.substring(0, 12)}...` : prevChapterTitle) : ''}
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.navButtonDisabled} />
      )}

      {/* Central Active Location indicator */}
      <View style={styles.activeContainer}>
        <Text style={styles.activeText} numberOfLines={1}>
          {currentChapterTitle}
        </Text>
      </View>

      {/* Next Chapter Control */}
      {canGoNext ? (
        <TouchableOpacity 
          onPress={navigateNext} 
          style={styles.navButton}
          testID="paginate-next-button"
        >
          <Text style={styles.navText}>
            {nextChapterTitle ? (nextChapterTitle.length > 15 ? `${nextChapterTitle.substring(0, 12)}...` : nextChapterTitle) : ''} ›
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.navButtonDisabled} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'hsl(220, 12%, 14%)',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'hsl(220, 12%, 20%)',
    paddingHorizontal: 12,
  },
  navButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 4,
    backgroundColor: 'hsl(220, 12%, 20%)',
    maxWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navButtonDisabled: {
    width: 60,
  },
  navText: {
    color: 'hsl(210, 100%, 75%)',
    fontSize: 13,
    fontWeight: '600',
  },
  activeContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 12,
  },
  activeText: {
    color: 'hsl(0, 0%, 90%)',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
