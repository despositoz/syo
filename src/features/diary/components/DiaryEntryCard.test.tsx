import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiaryEntryCard } from './DiaryEntryCard';
import type { DiaryEntry } from '@domain/diary/diary.types';
import { emptyAspects } from '@domain/rating/rating.types';

const entry = (overrides: Partial<DiaryEntry> = {}): DiaryEntry => ({
  id: 'entry-1',
  filmId: 7,
  filmTitle: 'Тихий свет',
  posterPath: '/p.jpg',
  releaseYear: '2023',
  mode: 'quick',
  overallRating: 4,
  preciseRating: 4,
  aspects: emptyAspects(),
  hasText: false,
  text: null,
  watchedAt: '2026-07-10T12:00:00.000Z',
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
  clientMutationId: 'mut-1',
  revision: 1,
  syncStatus: 'local',
  deletedAt: null,
  ...overrides,
});

const withText = (spoiler = false) =>
  entry({
    hasText: true,
    text: {
      selectedRevisionId: 'rev-1',
      revisions: [
        {
          id: 'rev-1',
          parentRevisionId: null,
          kind: 'user',
          origin: 'manual',
          text: 'Фильм оставил тишину, которую не хочется нарушать.',
          changeSummary: null,
          createdAt: '2026-07-10T12:00:00.000Z',
          promptVersion: null,
          requestId: null,
        },
      ],
      conversation: null,
      spoiler,
    },
  });

const show = (item: DiaryEntry, view: 'grid' | 'list') =>
  render(<DiaryEntryCard entry={item} view={view} onOpen={vi.fn()} />);

describe('the card gives its poster a frame', () => {
  it('wraps the poster in a frame that owns the geometry', () => {
    const { container } = show(entry(), 'grid');

    const frame = container.querySelector('[data-poster-frame]');
    expect(frame).not.toBeNull();
    // The poster is inside the frame, and carries no width of its own.
    const poster = frame!.querySelector<HTMLElement>('[data-poster-root]')!;
    expect(poster).not.toBeNull();
    expect(poster.style.width).toBe('');
  });
});

describe('grid and list carry different amounts of text', () => {
  it('the grid announces a text with a marker instead of quoting it', () => {
    show(withText(), 'grid');

    expect(screen.queryByTestId('card-excerpt')).not.toBeInTheDocument();
    expect(screen.getByTestId('card-text-marker')).toHaveAccessibleName('Есть текст');
  });

  it('a spoiler marker says so without giving anything away', () => {
    show(withText(true), 'grid');

    expect(screen.getByTestId('card-text-marker')).toHaveAccessibleName('Есть текст со спойлерами');
    expect(screen.queryByText(/тишину/)).not.toBeInTheDocument();
  });

  it('the list shows the real words the user wrote', () => {
    show(withText(), 'list');

    expect(screen.getByTestId('card-excerpt')).toHaveTextContent('Фильм оставил тишину');
    expect(screen.queryByTestId('card-text-marker')).not.toBeInTheDocument();
  });

  it('the list keeps a spoiler hidden behind a plain statement', () => {
    show(withText(true), 'list');

    expect(screen.getByTestId('card-excerpt')).toHaveTextContent('Есть текст со спойлерами');
    expect(screen.queryByText(/тишину/)).not.toBeInTheDocument();
  });
});

describe('the precise score is a number', () => {
  it('renders a deep score as readable text', () => {
    show(entry({ mode: 'deep', overallRating: 5, preciseRating: 4.6 }), 'grid');

    // It used to share a class with a 4×4px dot.
    expect(screen.getByTestId('card-precise')).toHaveTextContent('4,6');
  });

  it('stays out of the way when it matches the whole star', () => {
    show(entry({ overallRating: 4, preciseRating: 4 }), 'grid');

    expect(screen.queryByTestId('card-precise')).not.toBeInTheDocument();
  });
});
