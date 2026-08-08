import { db, readPreference, safeRead, strictWrite, writePreference } from '@shared/storage/db';
import {
  BIO_MAX,
  FAVORITES_MAX,
  NAME_MAX,
  PROFILE_SCHEMA_VERSION,
  emptyProfile,
  truncateGraphemes,
  type LocalProfile,
  type TelegramIdentity,
} from '../domain/profile.model';
import {
  ENGINE_VERSION,
  emptySnapshot,
  type TasteProfileSnapshot,
} from '../domain/taste-profile.model';

/**
 * Local profile storage (P0.5 §6, §27).
 *
 * The profile is the user's own writing and never leaves the device. The taste
 * snapshot is *derived*: a corrupt one is dropped and recomputed, and it is
 * never treated as a source of truth.
 */

/* --- parsing -------------------------------------------------------------- */

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

/**
 * Recovery, not rejection. A profile with one broken field keeps the rest —
 * losing a name the user typed because a timestamp went missing would be a
 * poor trade.
 */
export const parseProfile = (value: unknown, identity: TelegramIdentity): LocalProfile | null => {
  if (typeof value !== 'object' || value === null) return null;
  const source = value as Record<string, unknown>;

  const displayName = asString(source.displayName);
  if (!displayName) return null;

  const favorites = Array.isArray(source.favoriteFilmIds)
    ? [...new Set(source.favoriteFilmIds.filter((id): id is number => Number.isFinite(id)))].slice(
        0,
        FAVORITES_MAX,
      )
    : [];

  const now = new Date().toISOString();
  return {
    id: 'local',
    displayName: truncateGraphemes(displayName, NAME_MAX),
    bio: source.bio ? truncateGraphemes(String(source.bio), BIO_MAX) : null,
    telegramFirstName: asString(source.telegramFirstName) ?? identity.firstName,
    telegramLastName: asString(source.telegramLastName) ?? identity.lastName,
    telegramPhotoUrl: asString(source.telegramPhotoUrl) ?? identity.photoUrl,
    favoriteFilmIds: favorites,
    createdAt: asString(source.createdAt) ?? now,
    updatedAt: asString(source.updatedAt) ?? now,
    schemaVersion: PROFILE_SCHEMA_VERSION,
  };
};

/** A snapshot from an older engine is not wrong — it is simply out of date. */
export const parseSnapshot = (value: unknown): TasteProfileSnapshot | null => {
  if (typeof value !== 'object' || value === null) return null;
  const source = value as Record<string, unknown>;
  if (source.engineVersion !== ENGINE_VERSION) return null;
  if (typeof source.sourceRevision !== 'string') return null;
  if (!Array.isArray(source.genreSignals)) return null;
  return source as unknown as TasteProfileSnapshot;
};

/* --- repositories --------------------------------------------------------- */

export class ProfileRepository {
  /** Reads the profile, creating one from the Telegram identity if needed. */
  async read(identity: TelegramIdentity): Promise<LocalProfile> {
    const row = await safeRead(() => db.profiles.get('local'), undefined);
    return parseProfile(row, identity) ?? emptyProfile(identity);
  }

  async write(profile: LocalProfile): Promise<void> {
    await strictWrite(() =>
      db.profiles.put({ ...profile, updatedAt: new Date().toISOString() } as never),
    );
  }
}

export class TasteProfileRepository {
  async read(): Promise<TasteProfileSnapshot | null> {
    const row = await safeRead(() => db.tasteProfiles.get('current'), undefined);
    return parseSnapshot(row);
  }

  async write(snapshot: TasteProfileSnapshot): Promise<void> {
    await strictWrite(() => db.tasteProfiles.put(snapshot as never));
  }

  /** Derived data can always be thrown away and rebuilt (§27). */
  async clear(): Promise<void> {
    await strictWrite(() => db.tasteProfiles.clear());
  }
}

/* --- presentation preferences --------------------------------------------- */

export type MotionPreference = 'system' | 'calm' | 'expressive';
export type HapticsPreference = 'off' | 'delicate' | 'full';
export type AssistantMode = 'off' | 'ask' | 'available';

export interface PresentationPreferences {
  motion: MotionPreference;
  haptics: HapticsPreference;
  dynamicAmbient: boolean;
  assistantMode: AssistantMode;
  largeArtwork: boolean;
  updatedAt: string;
}

export const DEFAULT_PRESENTATION: PresentationPreferences = {
  motion: 'system',
  haptics: 'full',
  dynamicAmbient: true,
  assistantMode: 'available',
  largeArtwork: false,
  updatedAt: '1970-01-01T00:00:00.000Z',
};

const PRESENTATION_KEY = 'presentation.preferences';

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === 'string' && (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

/** Theme lives in its own store already; this covers the rest of §6.4. */
export const readPresentation = async (): Promise<PresentationPreferences> => {
  const stored = await readPreference<Partial<PresentationPreferences>>(PRESENTATION_KEY, {});
  return {
    motion: oneOf(stored.motion, ['system', 'calm', 'expressive'], DEFAULT_PRESENTATION.motion),
    haptics: oneOf(stored.haptics, ['off', 'delicate', 'full'], DEFAULT_PRESENTATION.haptics),
    dynamicAmbient: stored.dynamicAmbient ?? DEFAULT_PRESENTATION.dynamicAmbient,
    assistantMode: oneOf(
      stored.assistantMode,
      ['off', 'ask', 'available'],
      DEFAULT_PRESENTATION.assistantMode,
    ),
    largeArtwork: stored.largeArtwork ?? DEFAULT_PRESENTATION.largeArtwork,
    updatedAt:
      typeof stored.updatedAt === 'string' ? stored.updatedAt : DEFAULT_PRESENTATION.updatedAt,
  };
};

export const writePresentation = async (preferences: PresentationPreferences): Promise<void> => {
  await writePreference(PRESENTATION_KEY, { ...preferences, updatedAt: new Date().toISOString() });
};

export const profileRepository = new ProfileRepository();
export const tasteProfileRepository = new TasteProfileRepository();
export { emptySnapshot };
