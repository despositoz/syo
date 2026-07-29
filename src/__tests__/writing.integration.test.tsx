import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createTelegramFake,
  detailsFixture,
  installFetchMock,
  renderApp,
  resetAppState,
} from './harness';
import { db } from '@shared/storage/db';
import { emptyFilm } from '@entities/film/film.model';
import { writeFilmToCache } from '@entities/film/film.cache';
import { useDiaryStore } from '@features/diary/model/diary.store';
import { useWritingStore } from '@features/writing/model/writing.store';
import { useRatingStore } from '@features/rating/model/rating.store';
import { requestWritingDraft } from '@features/drafts/draftCoordinator';
import { selectedText } from '@domain/diary/diary.text';
import type { DiaryEntry } from '@domain/diary/diary.types';
import { emptyAspects } from '@domain/rating/rating.types';

const FILM_ID = 202;
const ENTRY_ID = 'entry-writing';

const entry = (overrides: Partial<DiaryEntry> = {}): DiaryEntry => ({
  id: ENTRY_ID,
  filmId: FILM_ID,
  filmTitle: 'Долгая дорога',
  posterPath: '/poster-202.jpg',
  releaseYear: '2022',
  mode: 'quick',
  overallRating: 4,
  preciseRating: 4,
  aspects: emptyAspects(),
  hasText: false,
  text: null,
  watchedAt: '2026-07-20T10:00:00.000Z',
  createdAt: '2026-07-20T10:00:00.000Z',
  updatedAt: '2026-07-20T10:00:00.000Z',
  clientMutationId: 'mut-writing',
  revision: 1,
  syncStatus: 'local',
  deletedAt: null,
  ...overrides,
});

/** Puts a saved rating in place: text is always added to an existing entry. */
const seedEntry = async (overrides: Partial<DiaryEntry> = {}) => {
  await db.diaryEntries.put(entry(overrides));
  await writeFilmToCache({
    ...emptyFilm(FILM_ID, 'Долгая дорога'),
    year: '2022',
    posterPath: '/poster-202.jpg',
    detailed: true,
  });
  await useDiaryStore.getState().hydrate();
};

const startWriting = async () => {
  const outcome = await requestWritingDraft({
    entryId: ENTRY_ID,
    film: {
      filmId: FILM_ID,
      filmTitle: 'Долгая дорога',
      posterPath: '/poster-202.jpg',
      releaseYear: '2022',
    },
    source: 'journalEntry',
  });
  if (outcome.kind === 'conflict') throw new Error('unexpected conflict');
  useWritingStore.setState({ hydrated: true });
};

beforeEach(async () => {
  await resetAppState();
  installFetchMock({ details: { [FILM_ID]: detailsFixture(FILM_ID) } });
  await seedEntry();
});

describe('writing a text without any assistant', () => {
  it('writes, previews and saves the text onto the entry', async () => {
    const user = userEvent.setup();
    await startWriting();
    renderApp({ telegram: createTelegramFake(), path: `/write/${ENTRY_ID}/mode` });

    await user.click(await screen.findByTestId('writing-mode-free'));

    const area = await screen.findByTestId('writing-textarea');
    await user.type(area, 'Фильм оставил тишину, которую не хочется нарушать.');

    await user.click(await screen.findByTestId('writing-to-preview'));
    expect(await screen.findByTestId('writing-preview-text')).toHaveTextContent(
      'Фильм оставил тишину',
    );

    await user.click(await screen.findByTestId('writing-save'));

    await waitFor(() => {
      const saved = useDiaryStore.getState().entries.find((item) => item.id === ENTRY_ID);
      expect(saved?.hasText).toBe(true);
    });

    const saved = useDiaryStore.getState().entries.find((item) => item.id === ENTRY_ID)!;
    expect(selectedText(saved.text)).toContain('не хочется нарушать');
    // The rating it belongs to is untouched.
    expect(saved.overallRating).toBe(4);
    expect(saved.mode).toBe('quick');
    // The draft is gone from both layers once the text is saved.
    await waitFor(() => expect(useWritingStore.getState().draft).toBeNull());
    expect(await db.ratingDrafts.count()).toBe(0);
  });

  it('keeps what was typed when the app is reopened', async () => {
    const user = userEvent.setup();
    await startWriting();
    const first = renderApp({ telegram: createTelegramFake(), path: `/write/${ENTRY_ID}/mode` });

    await user.click(await screen.findByTestId('writing-mode-free'));
    await user.type(await screen.findByTestId('writing-textarea'), 'Незаконченная мысль');
    await useWritingStore.getState().flush();
    first.unmount();

    // A cold start reads the draft back from storage, not from memory.
    useWritingStore.setState({ draft: null, hydrated: false });
    await useWritingStore.getState().hydrate();
    renderApp({ telegram: createTelegramFake(), path: `/write/${ENTRY_ID}/editor` });

    expect(await screen.findByTestId('writing-textarea')).toHaveValue('Незаконченная мысль');
  });

  it('an empty text is not saved as a text', async () => {
    const user = userEvent.setup();
    await startWriting();
    renderApp({ telegram: createTelegramFake(), path: `/write/${ENTRY_ID}/mode` });

    await user.click(await screen.findByTestId('writing-mode-free'));
    await user.type(await screen.findByTestId('writing-textarea'), '   ');

    // Nothing to preview: the way on is closed until there are words.
    expect(await screen.findByTestId('writing-to-preview')).toBeDisabled();
  });
});

describe('a saved text', () => {
  it('shows on the entry and can be removed with Undo', async () => {
    const user = userEvent.setup();
    await db.diaryEntries.clear();
    await seedEntry({
      hasText: true,
      text: {
        selectedRevisionId: 'rev-1',
        revisions: [
          {
            id: 'rev-1',
            parentRevisionId: null,
            kind: 'user',
            origin: 'manual',
            text: 'Сохранённый текст о фильме',
            changeSummary: null,
            createdAt: '2026-07-20T10:00:00.000Z',
            promptVersion: null,
            requestId: null,
          },
        ],
        conversation: null,
        spoiler: false,
      },
    });

    renderApp({ telegram: createTelegramFake(), path: `/diary/${ENTRY_ID}` });

    expect(await screen.findByTestId('entry-text-body')).toHaveTextContent(
      'Сохранённый текст о фильме',
    );

    await user.click(await screen.findByTestId('entry-menu'));
    await user.click(await screen.findByTestId('entry-delete-text'));

    await waitFor(() => {
      const updated = useDiaryStore.getState().entries.find((item) => item.id === ENTRY_ID);
      expect(updated?.hasText).toBe(false);
    });
    // The rating survived the text being deleted.
    expect(
      useDiaryStore.getState().entries.find((item) => item.id === ENTRY_ID)?.overallRating,
    ).toBe(4);

    await user.click(await screen.findByRole('button', { name: 'Вернуть' }));

    await waitFor(() => {
      const restored = useDiaryStore.getState().entries.find((item) => item.id === ENTRY_ID);
      expect(selectedText(restored?.text ?? null)).toBe('Сохранённый текст о фильме');
    });
  });

  it('hides a spoiler text until it is asked for', async () => {
    const user = userEvent.setup();
    await db.diaryEntries.clear();
    await seedEntry({
      hasText: true,
      text: {
        selectedRevisionId: 'rev-1',
        revisions: [
          {
            id: 'rev-1',
            parentRevisionId: null,
            kind: 'user',
            origin: 'manual',
            text: 'В финале все умирают',
            changeSummary: null,
            createdAt: '2026-07-20T10:00:00.000Z',
            promptVersion: null,
            requestId: null,
          },
        ],
        conversation: null,
        spoiler: true,
      },
    });

    renderApp({ telegram: createTelegramFake(), path: `/diary/${ENTRY_ID}` });

    expect(screen.queryByText('В финале все умирают')).not.toBeInTheDocument();
    await user.click(await screen.findByTestId('entry-text-reveal'));
    expect(await screen.findByTestId('entry-text-body')).toHaveTextContent('В финале все умирают');
  });
});

describe('one draft at a time', () => {
  it('asks before a rating replaces an unfinished text', async () => {
    const user = userEvent.setup();
    await startWriting();
    useWritingStore.getState().setText('Черновик, который жалко');
    await useWritingStore.getState().flush();

    renderApp({ telegram: createTelegramFake(), path: `/diary/${ENTRY_ID}` });
    await user.click(await screen.findByTestId('entry-menu'));
    await user.click(await screen.findByTestId('entry-edit'));

    // The text is still there and no rating draft was created behind its back.
    expect(await screen.findByTestId('conflict-discard')).toBeInTheDocument();
    expect(useWritingStore.getState().draft?.workingText).toBe('Черновик, который жалко');
    expect(useRatingStore.getState().draft).toBeNull();
  });
});
