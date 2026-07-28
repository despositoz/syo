import type { RatingAspectId, RatingValue } from './rating.types';

/**
 * Every word the rating flow says (spec §10, §15, §17-21, §27).
 *
 * The tone describes the user's own reaction, never the film's objective
 * quality: no verdicts, no memes, no "шедевр".
 */

export interface RatingAspect {
  id: RatingAspectId;
  /** The question that heads the step. */
  title: string;
  /** One supporting line under it. */
  subtitle: string;
  lowLabel: string;
  highLabel: string;
  /** Short name for the progress markers and the breakdown list. */
  shortName: string;
}

/** Fixed order — exactly five steps, never shown together. */
export const RATING_ASPECTS: readonly RatingAspect[] = [
  {
    id: 'story',
    shortName: 'Сюжет',
    title: 'Как сработала история?',
    subtitle: 'Ритм, логика и то, насколько хотелось следить дальше',
    lowLabel: 'Не увлекло',
    highLabel: 'Захватило',
  },
  {
    id: 'characters',
    shortName: 'Герои',
    title: 'Как тебе герои и актёрская игра?',
    subtitle: 'Насколько им верилось и хотелось за ними следить',
    lowLabel: 'Не поверил',
    highLabel: 'Очень живые',
  },
  {
    id: 'direction',
    shortName: 'Режиссура',
    title: 'Как фильм был сделан?',
    subtitle: 'Режиссура, кадр, атмосфера и визуальный язык',
    lowLabel: 'Не сработало',
    highLabel: 'Впечатлило',
  },
  {
    id: 'sound',
    shortName: 'Звук',
    title: 'Что сделал звук?',
    subtitle: 'Музыка, тишина, голос и общее звучание',
    lowLabel: 'Не запомнился',
    highLabel: 'Сильно повлиял',
  },
  {
    id: 'aftertaste',
    shortName: 'Послевкусие',
    title: 'Что осталось после фильма?',
    subtitle: 'Мысли, эмоции и желание вернуться к нему',
    lowLabel: 'Почти ничего',
    highLabel: 'Не отпускает',
  },
] as const;

export const ASPECT_IDS: readonly RatingAspectId[] = RATING_ASPECTS.map((aspect) => aspect.id);

export const DEEP_STEP_COUNT = RATING_ASPECTS.length;

export const aspectAtStep = (step: number): RatingAspect | undefined => RATING_ASPECTS[step];

export const aspectById = (id: RatingAspectId): RatingAspect => {
  const aspect = RATING_ASPECTS.find((item) => item.id === id);
  if (!aspect) throw new Error(`Unknown rating aspect: ${id}`);
  return aspect;
};

export const stepOfAspect = (id: RatingAspectId): number => ASPECT_IDS.indexOf(id);

export const isRatingAspectId = (value: string): value is RatingAspectId =>
  (ASPECT_IDS as readonly string[]).includes(value);

/** Live reaction under the stars in quick mode (spec §15). */
const QUICK_REACTIONS: Record<RatingValue, string> = {
  1: 'Совсем не твоё',
  2: 'Скорее не понравилось',
  3: 'Нормально',
  4: 'Очень понравилось',
  5: 'Останется с тобой',
};

export const quickReaction = (value: RatingValue | null): string =>
  value === null ? '' : QUICK_REACTIONS[value];

/** Closing line on the result page (spec §27). */
const RESULT_PHRASES: Record<RatingValue, string> = {
  1: 'Этот фильм совсем не сработал для тебя',
  2: 'В нём оказалось больше разочарования, чем удовольствия',
  3: 'Что-то сработало, но не всё',
  4: 'Фильм действительно тебе понравился',
  5: 'Похоже, это важный для тебя фильм',
};

export const resultPhrase = (overall: RatingValue): string => RESULT_PHRASES[overall];

export const MODE_LABELS = {
  quick: {
    title: 'Быстро',
    description: 'Поставить общую оценку',
    duration: 'Несколько секунд',
  },
  deep: {
    title: 'Разобрать впечатление',
    description: 'Пройтись по пяти сторонам фильма',
    duration: 'Около минуты',
  },
} as const;

export const MODE_QUESTION = 'Как хочешь оценить фильм?';
export const QUICK_QUESTION = 'Как тебе фильм в целом?';
/** Label above the running total during the deep flow (spec §25). */
export const CURRENT_TOTAL_LABEL = 'Сейчас';
