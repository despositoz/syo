import type { RatingAspectId, RatingValue } from './rating.types';

/**
 * All user-facing rating copy (spec §4, §7.4, §11.4).
 *
 * The word "критерий" never appears in the UI: aspects are named, not numbered.
 */

export interface RatingAspect {
  id: RatingAspectId;
  /** Screen title. */
  name: string;
  question: string;
  /** Extremes shown under the stars. */
  lowLabel: string;
  highLabel: string;
  /** Word for each value 0-5, indexed by value. */
  states: readonly [string, string, string, string, string, string];
}

/** Fixed order. Exactly five — no sixth step, no manual overall. */
export const RATING_ASPECTS: readonly RatingAspect[] = [
  {
    id: 'story',
    name: 'Сюжет',
    question: 'Насколько история держала тебя внутри фильма?',
    lowLabel: 'Рассыпался',
    highLabel: 'Не отпускал',
    states: ['Рассыпался', 'Потерял меня', 'Местами', 'Держал', 'Захватил', 'Не отпускал'],
  },
  {
    id: 'performance',
    name: 'Герои и актёрская игра',
    question: 'Насколько ты поверил героям и тем, кто их сыграл?',
    lowLabel: 'Не поверил',
    highLabel: 'Жил вместе с ними',
    states: ['Не поверил', 'Плоско', 'Неровно', 'Живо', 'Очень точно', 'Жил вместе с ними'],
  },
  {
    id: 'directionVisual',
    name: 'Режиссура и визуал',
    question: 'Насколько форма фильма работала на впечатление?',
    lowLabel: 'Без лица',
    highLabel: 'Не оторваться',
    states: ['Без лица', 'Случайно', 'Местами', 'Выразительно', 'Завораживает', 'Не оторваться'],
  },
  {
    id: 'soundMusic',
    name: 'Звук и музыка',
    question: 'Насколько звук усиливал то, что происходило?',
    lowLabel: 'Не заметил',
    highLabel: 'Пробирал',
    states: ['Мимо', 'Слабо', 'Заметно', 'Работает', 'Пробирает', 'Осталось в теле'],
  },
  {
    id: 'aftertaste',
    name: 'Что осталось',
    question: 'Насколько фильм продолжает жить в тебе после финала?',
    lowLabel: 'Ничего',
    highLabel: 'Не отпускает',
    states: [
      'Ничего',
      'Почти ничего',
      'Что-то осталось',
      'Зацепило',
      'Не отпускает',
      'Засело надолго',
    ],
  },
] as const;

export const ASPECT_IDS: readonly RatingAspectId[] = RATING_ASPECTS.map((aspect) => aspect.id);

export const ASPECT_COUNT = RATING_ASPECTS.length;

export const aspectById = (id: RatingAspectId): RatingAspect => {
  const aspect = RATING_ASPECTS.find((item) => item.id === id);
  if (!aspect) throw new Error(`Unknown rating aspect: ${id}`);
  return aspect;
};

export const aspectIndex = (id: RatingAspectId): number => ASPECT_IDS.indexOf(id);

export const isRatingAspectId = (value: string): value is RatingAspectId =>
  (ASPECT_IDS as readonly string[]).includes(value);

/** Words for the single quick score. */
export const QUICK_STATES: readonly [string, string, string, string, string, string] = [
  'Совсем не сработало',
  'Не твоё',
  'Слабо',
  'Хорошо',
  'Сильное впечатление',
  'Останется надолго',
];

/** Shown before any deliberate action — never a placeholder value. */
export const UNRATED_LABEL = 'Проведи по звёздам';

/**
 * Phrase for a final score, keyed by displayScore (0.5 steps).
 * Never judges the user: no "правильная оценка", no comparison to TMDB.
 */
const RESULT_PHRASES: ReadonlyMap<number, string> = new Map([
  [0, 'Совсем не сработало'],
  [0.5, 'Не твоё'],
  [1, 'Не твоё'],
  [1.5, 'Слабо'],
  [2, 'Слабо'],
  [2.5, 'Смешанные чувства'],
  [3, 'Хорошее впечатление'],
  [3.5, 'Сильное впечатление'],
  [4, 'Очень сильно'],
  [4.5, 'Почти идеально'],
  [5, 'Останется надолго'],
]);

export const resultPhrase = (displayScore: number): string =>
  RESULT_PHRASES.get(displayScore) ?? RESULT_PHRASES.get(Math.round(displayScore * 2) / 2) ?? '';

export const quickStateLabel = (value: RatingValue | null): string =>
  value === null ? UNRATED_LABEL : QUICK_STATES[value];

export const aspectStateLabel = (id: RatingAspectId, value: RatingValue | null): string =>
  value === null ? UNRATED_LABEL : aspectById(id).states[value];
