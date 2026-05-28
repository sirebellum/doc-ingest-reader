import { PaginationBar } from '../PaginationBar';

describe('PaginationBar Component Logic', () => {
  it('should render correct navigation display string containing active, next, and previous titles', () => {
    const bar = PaginationBar({
      currentChapterTitle: 'Ch 3: Database',
      prevChapterTitle: 'Ch 2: Parser',
      nextChapterTitle: 'Ch 4: Inference',
      onNavigate: jest.fn(),
    });

    expect(bar.displayString).toBe('< Ch 2: Parser   [Ch 3: Database]   Ch 4: Inference >');
    expect(bar.canGoPrev).toBe(true);
    expect(bar.canGoNext).toBe(true);
  });

  it('should format correctly and set navigation flags if neighboring sections are missing', () => {
    const bar = PaginationBar({
      currentChapterTitle: 'Ch 1: Intro',
      onNavigate: jest.fn(),
    });

    expect(bar.displayString).toBe('[Ch 1: Intro]');
    expect(bar.canGoPrev).toBe(false);
    expect(bar.canGoNext).toBe(false);
  });

  it('should call onNavigate handlers when adjacent navigations are requested', () => {
    const mockNavigate = jest.fn();
    const bar = PaginationBar({
      currentChapterTitle: 'Ch 2: Setup',
      prevChapterTitle: 'Ch 1: Intro',
      nextChapterTitle: 'Ch 3: Run',
      onNavigate: mockNavigate,
    });

    bar.navigatePrev();
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenLastCalledWith('prev');

    bar.navigateNext();
    expect(mockNavigate).toHaveBeenCalledTimes(2);
    expect(mockNavigate).toHaveBeenLastCalledWith('next');
  });
});
