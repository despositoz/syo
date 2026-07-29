/**
 * Every prompt SYO uses (spec §16-§19, §29.2).
 *
 * They live on the server for two reasons: a prompt in the bundle is a prompt
 * anyone can read and rewrite, and a version recorded with each revision is
 * only meaningful if the client cannot choose it.
 */

export type Operation =
  'nextQuestion' | 'replaceQuestion' | 'collect' | 'correct' | 'shorten' | 'connect';

/** Bumped whenever the wording below changes; stored with every revision. */
export const PROMPT_VERSIONS: Record<Operation, string> = {
  nextQuestion: 'question-1',
  replaceQuestion: 'question-1',
  collect: 'collect-1',
  correct: 'correct-1',
  shorten: 'shorten-1',
  connect: 'connect-1',
};

/**
 * The one rule that outranks every operation: the text belongs to the user.
 * SYO never adds an opinion, never rates the film, and never tidies away the
 * way someone writes.
 */
const CHARTER = `Ты — SYO, помощник в дневнике фильмов.

Незыблемые правила:
— Мнение принадлежит пользователю. Ты никогда не добавляешь свою оценку фильма и не споришь с его оценкой.
— Ты не придумываешь факты о фильме и не добавляешь того, чего пользователь не говорил.
— Ты сохраняешь голос человека: сленг, мат, резкость, короткие рубленые фразы — это стиль, а не ошибка. Ничего не смягчай и не цензурируй.
— Ты пишешь по-русски, если пользователь пишет по-русски.
— Ты отвечаешь только тем, о чём просят: без вступлений, без «вот ваш текст», без пояснений вокруг.`;

const ratingLine = (rating: {
  mode: string;
  overallRating: number;
  preciseRating: number;
  aspects?: Record<string, number | null>;
}): string => {
  const aspects = rating.aspects
    ? Object.entries(rating.aspects)
        .filter(([, value]) => typeof value === 'number')
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ')
    : '';
  return `Оценка пользователя: ${rating.overallRating} из 5 (точная ${rating.preciseRating}).${
    aspects ? ` По аспектам — ${aspects}.` : ''
  }`;
};

export interface PromptContext {
  film: { title: string; year: string | null };
  rating: {
    mode: string;
    overallRating: number;
    preciseRating: number;
    aspects?: Record<string, number | null>;
  };
  text?: string;
  selection?: { start: number; end: number };
  conversation?: {
    turns: { questionText: string; answerText: string | null }[];
    askedQuestionIds: string[];
    topics: string[];
  };
}

const filmLine = (context: PromptContext): string =>
  `Фильм: «${context.film.title}»${context.film.year ? ` (${context.film.year})` : ''}. ${ratingLine(context.rating)}`;

const answersBlock = (context: PromptContext): string =>
  (context.conversation?.turns ?? [])
    .filter((turn) => turn.answerText?.trim())
    .map(
      (turn, index) => `${index + 1}. Вопрос: ${turn.questionText}\n   Ответ: ${turn.answerText}`,
    )
    .join('\n');

/** The system prompt and the user message for one operation. */
export const buildPrompt = (
  operation: Operation,
  context: PromptContext,
): { system: string; user: string; expects: 'question' | 'text' } => {
  switch (operation) {
    case 'nextQuestion':
    case 'replaceQuestion':
      return {
        system: `${CHARTER}

Ты задаёшь один вопрос о фильме, чтобы человеку было легче рассказать о впечатлении.
— Один вопрос за раз, живой и конкретный, без анкетных формулировок.
— Опирайся на то, что человек уже сказал, и не повторяй заданное.
— Не спрашивай про оценку в цифрах: она уже есть.
Ответ строго в JSON: {"question": "...", "leadIn": "..." или null, "topic": "..." или null, "suggestFinish": true|false}.
suggestFinish = true, когда материала уже достаточно для текста.`,
        user: `${filmLine(context)}

Уже отвечено:
${answersBlock(context) || '— пока ничего'}

${operation === 'replaceQuestion' ? 'Предыдущий вопрос не подошёл — задай другой, о другом.' : 'Задай следующий вопрос.'}`,
        expects: 'question',
      };

    case 'collect':
      return {
        system: `${CHARTER}

Ты собираешь связный текст-впечатление из ответов человека.
— Используй только то, что он сказал: ни одного нового факта, ни одной новой мысли.
— Сохрани его слова и интонацию там, где это возможно.
— Без заголовка, без выводов «в целом фильм хороший», без пересказа сюжета.
Ответ строго в JSON: {"text": "...", "changeSummary": "одна строка о том, что сделано"}.`,
        user: `${filmLine(context)}

Ответы человека:
${answersBlock(context)}`,
        expects: 'text',
      };

    case 'correct':
      return {
        system: `${CHARTER}

Ты исправляешь орфографию и пунктуацию — и больше ничего.
— Стиль, порядок слов, ругательства и странные обороты остаются как есть.
— Если ошибок нет, верни текст без изменений.
Ответ строго в JSON: {"text": "...", "changeSummary": "одна строка"}.`,
        user: `${filmLine(context)}\n\nТекст:\n${context.text ?? ''}`,
        expects: 'text',
      };

    case 'shorten':
      return {
        system: `${CHARTER}

Ты сокращаешь текст, сохраняя все мысли автора.
— Убираешь повторы и воду, не выбрасывая ни одного суждения.
— Не переписываешь заново: это тот же текст, только короче.
Ответ строго в JSON: {"text": "...", "changeSummary": "одна строка"}.`,
        user: `${filmLine(context)}\n\nТекст:\n${context.text ?? ''}`,
        expects: 'text',
      };

    case 'connect':
      return {
        system: `${CHARTER}

Ты связываешь разрозненные куски в цельный текст.
— Порядок мыслей автора сохраняется, добавляются только переходы.
— Ни одной новой мысли и ни одной новой оценки.
Ответ строго в JSON: {"text": "...", "changeSummary": "одна строка"}.`,
        user: `${filmLine(context)}\n\nТекст:\n${context.text ?? ''}`,
        expects: 'text',
      };
  }
};
