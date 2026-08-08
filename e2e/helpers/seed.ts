import type { Page } from '@playwright/test';

/**
 * Puts diary entries straight into IndexedDB.
 *
 * Rating six films through the UI takes a minute per test; the layout under
 * test does not care how the rows got there, only that they exist.
 */

export interface SeedEntryOptions {
  count?: number;
  /** Applied to every entry after the defaults. */
  overrides?: (index: number) => Record<string, unknown>;
}

const revision = (text: string) => ({
  id: 'rev-1',
  parentRevisionId: null,
  kind: 'user',
  origin: 'manual',
  text,
  changeSummary: null,
  createdAt: '2026-07-20T10:00:00.000Z',
  promptVersion: null,
  requestId: null,
});

export const diaryText = (text: string, spoiler = false) => ({
  selectedRevisionId: 'rev-1',
  revisions: [revision(text)],
  conversation: null,
  spoiler,
});

/**
 * Puts films into the local film cache with the fields the insight engine
 * reads: genres, director and cast. Without them an observation cannot be
 * derived at all, so a test that expects one has to provide them.
 */
export const seedFilms = async (
  page: Page,
  films: { id: number; title?: string; genres?: string[]; director?: string; cast?: string[] }[],
): Promise<void> => {
  const rows = films.map((film) => ({
    id: film.id,
    cachedAt: Date.now(),
    film: {
      id: film.id,
      title: film.title ?? `Фильм ${film.id}`,
      originalTitle: `Movie ${film.id}`,
      year: '2023',
      releaseDate: '2023-05-01',
      genres: film.genres ?? ['драма'],
      posterPath: '/poster.png',
      backdropPath: '/backdrop.png',
      overview: 'Описание',
      rating: 7.5,
      voteCount: 900,
      accent: { hex: '#6f2a35', rgb: '111, 42, 53' },
      runtime: 110,
      director: film.director ?? 'Режиссёр Тест',
      cast: (film.cast ?? ['Актриса Тест']).map((name, index) => ({
        id: 1000 + index,
        name,
        character: 'Она',
        profilePath: '/profile.png',
      })),
      logoCandidates: [],
      tagline: '',
      countries: ['США'],
      productionCompanies: ['Studio'],
      originalLanguage: 'en',
      budget: 0,
      revenue: 0,
      detailed: true,
    },
  }));

  await page.evaluate(async (entries) => {
    const open = () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('syo');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('films', 'readwrite');
      const store = transaction.objectStore('films');
      for (const entry of entries) store.put(entry);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, rows);
};

export const seedDiary = async (page: Page, options: SeedEntryOptions = {}): Promise<void> => {
  const count = options.count ?? 6;
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `seed-${index}`,
    filmId: 500 + index,
    filmTitle: `Фильм ${index + 1}`,
    posterPath: '/poster.png',
    releaseYear: '2023',
    mode: 'quick',
    overallRating: ((index % 5) + 1) as 1 | 2 | 3 | 4 | 5,
    preciseRating: ((index % 5) + 1) as number,
    aspects: {
      story: null,
      characters: null,
      direction: null,
      sound: null,
      aftertaste: null,
    },
    hasText: false,
    text: null,
    watchedAt: `2026-07-${String(10 + index).padStart(2, '0')}T10:00:00.000Z`,
    createdAt: `2026-07-${String(10 + index).padStart(2, '0')}T10:00:00.000Z`,
    updatedAt: `2026-07-${String(10 + index).padStart(2, '0')}T10:00:00.000Z`,
    clientMutationId: `mut-${index}`,
    revision: 1,
    syncStatus: 'local',
    deletedAt: null,
    ...(options.overrides?.(index) ?? {}),
  }));

  await page.evaluate(async (entries) => {
    // The app has already opened the database, so its version is whatever the
    // running build uses — open without one and take what is there.
    const open = () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('syo');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('diaryEntries', 'readwrite');
      const store = transaction.objectStore('diaryEntries');
      for (const entry of entries) store.put(entry);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, rows);
};
