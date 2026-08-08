import { db, safeRead, strictWrite } from '@shared/storage/db';

/**
 * Export and erase (P0.5 §17).
 *
 * The file is written on the device and never uploaded — there is no endpoint
 * in this module and no fetch anywhere in it. Erasing is deliberate, staged,
 * and offers the export first.
 */

export const EXPORT_SCHEMA_VERSION = 1;

export interface SyoExport {
  schemaVersion: number;
  exportedAt: string;
  app: 'syo';
  profile: unknown;
  preferences: unknown[];
  diary: unknown[];
  watchlist: unknown[];
  feedFeedback: unknown[];
  /** Derived, and marked as such: the diary is the source of truth (§17.1). */
  derived: { tasteProfile: unknown | null };
}

/** What the confirmation sheet lists before anything is written. */
export const exportSummary = (): string[] => [
  'профиль: имя, о себе, любимые фильмы',
  'Дневник: оценки, аспекты, даты',
  'тексты и их версии',
  '«Посмотреть позже»',
  'настройки внешнего вида',
  'почерк — как производные данные',
];

export const buildExport = async (): Promise<SyoExport> => {
  const [profile, preferences, diary, watchlist, feedback, taste] = await Promise.all([
    safeRead(() => db.profiles.get('local'), undefined),
    safeRead(() => db.preferences.toArray(), []),
    safeRead(() => db.diaryEntries.toArray(), []),
    safeRead(() => db.watchlist.toArray(), []),
    safeRead(() => db.feedFeedback.toArray(), []),
    safeRead(() => db.tasteProfiles.get('current'), undefined),
  ]);

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'syo',
    profile: profile ?? null,
    preferences,
    // The diary carries the texts and their revisions with it.
    diary,
    watchlist,
    feedFeedback: feedback,
    derived: { tasteProfile: taste ?? null },
  };
};

export const exportFileName = (now = new Date()): string =>
  `syo-export-${now.toISOString().slice(0, 10)}.json`;

/** Hands the file to the browser. No network, no share target, no upload. */
export const downloadExport = (archive: SyoExport, now = new Date()): void => {
  const blob = new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = exportFileName(now);
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick: Safari needs the URL alive during the click.
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

/**
 * Everything the user made, in one transaction. The film cache is left alone:
 * it is not personal data, and clearing it would only make the next launch
 * slower.
 */
export const clearLocalData = async (): Promise<void> => {
  await strictWrite(() =>
    db.transaction(
      'rw',
      [
        db.profiles,
        db.tasteProfiles,
        db.diaryEntries,
        db.ratingDrafts,
        db.watchlist,
        db.preferences,
        db.syncQueue,
        db.feed,
        db.feedFeedback,
        db.feedImpressions,
        db.feedPosition,
      ],
      async () => {
        await Promise.all([
          db.profiles.clear(),
          db.tasteProfiles.clear(),
          db.diaryEntries.clear(),
          db.ratingDrafts.clear(),
          db.watchlist.clear(),
          db.preferences.clear(),
          db.syncQueue.clear(),
          db.feed.clear(),
          db.feedFeedback.clear(),
          db.feedImpressions.clear(),
          db.feedPosition.clear(),
        ]);
      },
    ),
  );

  // The synchronous draft mirror lives outside IndexedDB.
  try {
    localStorage.removeItem('syo:rating-draft:active');
  } catch {
    // A blocked localStorage is not a reason to fail the erase.
  }
};
