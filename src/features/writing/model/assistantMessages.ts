import type { AssistantError } from '../gateway/assistant.gateway';

/**
 * What the user is told when a request fails (spec §22).
 *
 * Always in terms of what happened to *their* text — never a status code,
 * never a provider name, never the provider's own message.
 */
export const assistantErrorText = (error: AssistantError): string => {
  switch (error.code) {
    case 'offline':
      return 'Нет связи. Текст сохранён — попробуй ещё раз, когда появится интернет.';
    case 'timeout':
      return 'SYO не успел ответить. Твой текст на месте.';
    case 'rateLimited':
      return 'Слишком много запросов подряд. Подожди немного и попробуй снова.';
    case 'unauthorized':
      return 'Не получилось подтвердить, что это ты. Открой приложение из Telegram заново.';
    case 'contentRejected':
      return 'SYO не смог с этим помочь. Твой текст остался без изменений.';
    case 'providerUnavailable':
      return 'SYO сейчас недоступен. Текст сохранён, попробуй позже.';
    case 'cancelled':
      return '';
    default:
      return 'Что-то пошло не так. Твой текст остался без изменений.';
  }
};

/** What is happening while the request is in the air (spec §20.2). */
export const assistantBusyText = (operation: string): string => {
  switch (operation) {
    case 'nextQuestion':
    case 'replaceQuestion':
      return 'SYO думает над вопросом';
    case 'collect':
      return 'SYO собирает текст из твоих ответов';
    case 'correct':
      return 'SYO проверяет текст';
    case 'shorten':
      return 'SYO сокращает текст';
    case 'connect':
      return 'SYO связывает части текста';
    default:
      return 'SYO работает';
  }
};

/** The label of a saved version in the history (spec §21.7). */
export const revisionLabel = (origin: string, kind: 'user' | 'assistant'): string => {
  if (kind === 'user') return origin === 'manual' ? 'Твой текст' : 'Твоя правка';
  switch (origin) {
    case 'collect':
      return 'Собрано из ответов';
    case 'correct':
      return 'После проверки';
    case 'shorten':
      return 'Сокращённая версия';
    case 'connect':
      return 'Связанная версия';
    default:
      return 'Версия SYO';
  }
};
