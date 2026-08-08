import { create } from 'zustand';
import { db, safeRead, StorageError } from '@shared/storage/db';
import { parseCachedFilm } from '@entities/film/film.schema';
import type { Film } from '@entities/film/film.model';
import { useDiaryStore } from '@features/diary/model/diary.store';
import { getTelegramController } from '@app/telegram/telegramStore';
import {
  addFavorite,
  moveFavorite,
  removeFavorite,
  replaceFavorite,
  type LocalProfile,
  type TelegramIdentity,
} from '../domain/profile.model';
import { computeTasteProfile } from '../domain/taste-profile.engine';
import { emptySnapshot, type TasteProfileSnapshot } from '../domain/taste-profile.model';
import {
  profileRepository,
  tasteProfileRepository,
  readPresentation,
  writePresentation,
  DEFAULT_PRESENTATION,
  type PresentationPreferences,
} from '../data/profile.repository';

/**
 * Profile state (P0.5 §26).
 *
 * The store owns the in-memory copy and writes every change straight away.
 * The taste snapshot is recomputed outside React whenever the archive moves,
 * and the previous one stays visible while the new one is built (§18).
 */

export interface ProfileState {
  profile: LocalProfile | null;
  snapshot: TasteProfileSnapshot;
  preferences: PresentationPreferences;
  hydrated: boolean;
  computing: boolean;
  storageError: StorageError | null;
  /** Films the profile needs by id: favourites and evidence posters. */
  films: Map<number, Film>;

  hydrate: () => Promise<void>;
  /** Recomputes the signature if the archive has actually changed. */
  refreshSnapshot: (options?: { force?: boolean }) => Promise<void>;
  save: (patch: Partial<Pick<LocalProfile, 'displayName' | 'bio'>>) => Promise<void>;
  resetToTelegram: () => Promise<void>;
  addFavorite: (filmId: number) => Promise<'added' | 'needsReplacement' | 'already'>;
  removeFavorite: (filmId: number) => Promise<void>;
  replaceFavorite: (remove: number, add: number) => Promise<void>;
  moveFavorite: (filmId: number, to: number) => Promise<void>;
  setPreferences: (patch: Partial<PresentationPreferences>) => Promise<void>;
}

const identityOf = (): TelegramIdentity => {
  const user = getTelegramController().getUser();
  return {
    firstName: user?.firstName ?? null,
    lastName: user?.lastName ?? null,
    photoUrl: user?.photoUrl ?? null,
  };
};

const readFilms = async (): Promise<Map<number, Film>> => {
  const rows = await safeRead(() => db.films.toArray(), []);
  const films = new Map<number, Film>();
  for (const row of rows) {
    const film = parseCachedFilm(row.film);
    if (film) films.set(film.id, film);
  }
  return films;
};

export const useProfileStore = create<ProfileState>((set, get) => {
  /** Writes the profile and keeps the signature in step with it. */
  const persist = async (next: LocalProfile): Promise<void> => {
    set({ profile: next });
    try {
      await profileRepository.write(next);
      if (get().storageError) set({ storageError: null });
    } catch (error) {
      const failure = error instanceof StorageError ? error : new StorageError('unknown', error);
      set({ storageError: failure });
      throw failure;
    }
    await get().refreshSnapshot();
  };

  return {
    profile: null,
    snapshot: emptySnapshot(),
    preferences: DEFAULT_PRESENTATION,
    hydrated: false,
    computing: false,
    storageError: null,
    films: new Map(),

    hydrate: async () => {
      const identity = identityOf();
      const [profile, stored, preferences, films] = await Promise.all([
        profileRepository.read(identity),
        tasteProfileRepository.read(),
        readPresentation(),
        readFilms(),
      ]);

      // A stored snapshot paints immediately; a fresh one follows if the
      // archive has moved since it was written (§18).
      set({
        profile,
        snapshot: stored ?? emptySnapshot(),
        preferences,
        films,
        hydrated: true,
      });
      await get().refreshSnapshot();
    },

    refreshSnapshot: async (options = {}) => {
      const profile = get().profile;
      if (!profile) return;

      const [films, entries] = [await readFilms(), useDiaryStore.getState().entries];
      const next = computeTasteProfile({
        entries,
        films,
        favoriteFilmIds: profile.favoriteFilmIds,
        now: new Date().toISOString(),
      });

      // Nothing changed: keep the snapshot we have rather than rewriting it.
      if (!options.force && next.sourceRevision === get().snapshot.sourceRevision) {
        set({ films });
        return;
      }

      set({ snapshot: next, films, computing: false });
      await tasteProfileRepository.write(next).catch(() => undefined);
    },

    save: async (patch) => {
      const profile = get().profile;
      if (!profile) return;
      await persist({ ...profile, ...patch, updatedAt: new Date().toISOString() });
    },

    resetToTelegram: async () => {
      const profile = get().profile;
      if (!profile) return;
      const identity = identityOf();
      await persist({
        ...profile,
        displayName:
          [identity.firstName, identity.lastName].filter(Boolean).join(' ').trim() || 'Ты',
        telegramFirstName: identity.firstName,
        telegramLastName: identity.lastName,
        telegramPhotoUrl: identity.photoUrl,
      });
    },

    addFavorite: async (filmId) => {
      const profile = get().profile;
      if (!profile) return 'already';
      if (profile.favoriteFilmIds.includes(filmId)) return 'already';

      const change = addFavorite(profile.favoriteFilmIds, filmId);
      // The list is full: the caller has to ask which film leaves (§14.2).
      if (change.needsReplacement) return 'needsReplacement';

      await persist({ ...profile, favoriteFilmIds: change.ids });
      return 'added';
    },

    removeFavorite: async (filmId) => {
      const profile = get().profile;
      if (!profile) return;
      await persist({
        ...profile,
        favoriteFilmIds: removeFavorite(profile.favoriteFilmIds, filmId),
      });
    },

    replaceFavorite: async (remove, add) => {
      const profile = get().profile;
      if (!profile) return;
      await persist({
        ...profile,
        favoriteFilmIds: replaceFavorite(profile.favoriteFilmIds, remove, add),
      });
    },

    moveFavorite: async (filmId, to) => {
      const profile = get().profile;
      if (!profile) return;
      const ids = moveFavorite(profile.favoriteFilmIds, filmId, to);
      if (ids === profile.favoriteFilmIds) return;
      await persist({ ...profile, favoriteFilmIds: ids });
    },

    setPreferences: async (patch) => {
      const next = { ...get().preferences, ...patch, updatedAt: new Date().toISOString() };
      set({ preferences: next });
      await writePresentation(next);
    },
  };
});

/** Test seam and cold-start helper. */
export const resetProfileStore = (): void => {
  useProfileStore.setState({
    profile: null,
    snapshot: emptySnapshot(),
    preferences: DEFAULT_PRESENTATION,
    hydrated: false,
    computing: false,
    storageError: null,
    films: new Map(),
  });
};
