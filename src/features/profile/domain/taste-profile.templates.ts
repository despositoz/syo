import { RATING_ASPECTS } from '@domain/rating/rating.constants';
import type { TasteHeadline, TasteProfileSnapshot } from './taste-profile.model';

/**
 * Every sentence the taste signature can say (P0.5 §10, §27).
 *
 * Templates, not generation: each one is tied to a signal that passed its
 * threshold, and each carries the evidence keys behind it. Nothing here
 * flatters, diagnoses, or describes a personality — it describes an archive.
 */

const aspectName = (aspect: string): string =>
  RATING_ASPECTS.find((item) => item.id === aspect)?.shortName ?? aspect;

const lower = (value: string): string => value.charAt(0).toLowerCase() + value.slice(1);

/**
 * The headline takes the one or two strongest *independent* signals. It is
 * hedged while the archive is still forming, and it never repeats the numbers
 * the cards below already show.
 */
export const buildHeadline = (snapshot: TasteProfileSnapshot): TasteHeadline | null => {
  if (snapshot.confidence === 'insufficient') return null;

  const forming = snapshot.confidence === 'forming';
  const genre = snapshot.genreSignals.find((signal) => signal.kind === 'affinity');
  const director = snapshot.directorSignals[0];
  const aspect = snapshot.aspectSignature;

  // Strongest first: an aspect signature says more than a genre count.
  if (aspect && genre) {
    return {
      templateId: 'aspect+genre',
      text: forming
        ? `Пока похоже, что оценку вытягивает ${lower(aspectName(aspect.leadAspect))}, а выше остального держится ${lower(genre.genre)}`
        : `Твою оценку чаще всего поднимает ${lower(aspectName(aspect.leadAspect))}, а выше остального держится ${lower(genre.genre)}`,
      evidenceKeys: [aspect.evidenceKey, genre.evidenceKey],
    };
  }

  if (aspect) {
    return {
      templateId: 'aspect',
      text: forming
        ? `Пока сильнее всего на твою оценку влияет ${lower(aspectName(aspect.leadAspect))}`
        : `Твою итоговую оценку чаще всего поднимает ${lower(aspectName(aspect.leadAspect))}`,
      evidenceKeys: [aspect.evidenceKey],
    };
  }

  if (director && genre) {
    return {
      templateId: 'director+genre',
      text: forming
        ? `Пока выше остального держится ${lower(genre.genre)}, и чаще других повторяется один режиссёр — ${director.name}`
        : `Выше остального держится ${lower(genre.genre)}, и чаще других повторяется один режиссёр — ${director.name}`,
      evidenceKeys: [director.evidenceKey, genre.evidenceKey],
    };
  }

  if (genre) {
    return {
      templateId: 'genre',
      text: forming
        ? `Пока выше остального у тебя держится ${lower(genre.genre)}`
        : `Выше остального у тебя держится ${lower(genre.genre)}`,
      evidenceKeys: [genre.evidenceKey],
    };
  }

  if (director) {
    return {
      templateId: 'director',
      text: forming
        ? `Пока в архиве чаще других повторяется один режиссёр — ${director.name}`
        : `Один режиссёр держится у тебя особенно высоко — ${director.name}`,
      evidenceKeys: [director.evidenceKey],
    };
  }

  const behavior = snapshot.ratingBehavior;
  if (behavior && behavior.deepCount >= behavior.quickCount && behavior.deepCount > 0) {
    return {
      templateId: 'deepRater',
      text: 'Ты чаще разбираешь фильм по частям, чем ставишь оценку одним движением',
      evidenceKeys: [behavior.evidenceKey],
    };
  }

  // Nothing strong enough yet, and that is a fine thing to say (§10).
  return { templateId: 'forming', text: 'Твой почерк ещё складывается', evidenceKeys: [] };
};

/** The line under the headline that explains how sure this is. */
export const confidenceLine = (snapshot: TasteProfileSnapshot): string => {
  switch (snapshot.confidence) {
    case 'insufficient':
      return 'Пока слишком мало оценок, чтобы что-то утверждать';
    case 'forming':
      return `Складывается по ${snapshot.ratedCount} оценкам — чем больше, тем точнее`;
    case 'stable':
      return `Посчитано по ${snapshot.ratedCount} оценкам в твоём Дневнике`;
  }
};

export const genreLine = (signal: { genre: string; support: number; kind: string }): string =>
  signal.kind === 'affinity'
    ? `${signal.genre}: ${signal.support} ${plural(signal.support, 'фильм', 'фильма', 'фильмов')} выше твоего среднего`
    : `${signal.genre}: возвращаешься, но оцениваешь строже`;

export const personLine = (signal: { name: string; support: number }): string =>
  `${signal.name} — ${signal.support} ${plural(signal.support, 'фильм', 'фильма', 'фильмов')} в архиве`;

export const aspectLine = (aspect: string): string => aspectName(aspect);

export const plural = (count: number, one: string, few: string, many: string): string => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

/** One editorial line for the archive summary (§11.4). */
export const archiveLine = (snapshot: TasteProfileSnapshot): string => {
  const parts = [
    `${snapshot.ratedCount} ${plural(snapshot.ratedCount, 'фильм', 'фильма', 'фильмов')}`,
  ];
  const deep = snapshot.ratingBehavior?.deepCount ?? 0;
  if (deep)
    parts.push(
      `${deep} ${plural(deep, 'подробная оценка', 'подробные оценки', 'подробных оценок')}`,
    );
  if (snapshot.writtenCount) {
    parts.push(
      `${snapshot.writtenCount} ${plural(snapshot.writtenCount, 'запись', 'записи', 'записей')}`,
    );
  }
  return `В твоём архиве — ${parts.join(', ')}.`;
};
