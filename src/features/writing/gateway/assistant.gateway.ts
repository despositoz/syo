import type {
  AssistantOperation,
  ConversationQuestion,
  ConversationTurn,
  TextOperation,
} from '@domain/writing/writing.types';

/**
 * The only way the app talks to the assistant (spec §14, §29).
 *
 * The browser calls SYO's own backend and nothing else. No provider name, no
 * model name, no API key and no prompt ever exists in this bundle: the backend
 * owns all of it, and this file could be published without leaking anything.
 */

export interface AssistantFilmContext {
  filmId: number;
  title: string;
  year: string | null;
}

/** The user's own rating, so the assistant does not contradict it (§16.3). */
export interface AssistantRatingContext {
  mode: 'quick' | 'deep';
  overallRating: number;
  preciseRating: number;
  aspects?: Record<string, number | null>;
}

export interface AssistantRequest {
  /** Stable across retries of the same logical request (§20.5). */
  requestId: string;
  operation: AssistantOperation;
  film: AssistantFilmContext;
  rating: AssistantRatingContext;
  /** The current text, for operations that transform it. */
  text?: string;
  /** Character range the operation applies to, when the user selected one. */
  selection?: { start: number; end: number };
  /** Answered turns only: a skip carries no words to work from. */
  conversation?: {
    sessionId: string;
    turns: Pick<ConversationTurn, 'questionId' | 'questionText' | 'answerText'>[];
    askedQuestionIds: string[];
    topics: string[];
  };
  signal?: AbortSignal;
}

export interface AssistantQuestionResult {
  kind: 'question';
  requestId: string;
  promptVersion: string;
  question: ConversationQuestion;
}

export interface AssistantTextResult {
  kind: 'text';
  requestId: string;
  promptVersion: string;
  operation: TextOperation;
  text: string;
  /** One line about what changed, shown above the candidate (§21.4). */
  changeSummary: string;
}

export type AssistantResult = AssistantQuestionResult | AssistantTextResult;

export type AssistantErrorCode =
  | 'offline'
  | 'timeout'
  | 'unauthorized'
  | 'rateLimited'
  | 'invalidRequest'
  | 'providerUnavailable'
  | 'contentRejected'
  | 'cancelled'
  | 'unknown';

/**
 * A failure the UI can speak about. The provider's own message is never shown
 * and never stored — it may contain the prompt or fragments of the text.
 */
export class AssistantError extends Error {
  constructor(
    readonly code: AssistantErrorCode,
    /** Seconds to wait, when the backend said so. */
    readonly retryAfter?: number,
  ) {
    super(code);
    this.name = 'AssistantError';
  }

  /** Trying again can plausibly succeed. */
  get retriable(): boolean {
    return (
      this.code === 'offline' ||
      this.code === 'timeout' ||
      this.code === 'rateLimited' ||
      this.code === 'providerUnavailable' ||
      this.code === 'unknown'
    );
  }
}

export interface AssistantGateway {
  send(request: AssistantRequest): Promise<AssistantResult>;
}

/** Long enough for a real answer, short enough that a dead call is noticed. */
export const ASSISTANT_TIMEOUT_MS = 30_000;

const ERROR_CODES: readonly AssistantErrorCode[] = [
  'unauthorized',
  'rateLimited',
  'invalidRequest',
  'providerUnavailable',
  'contentRejected',
];

const toErrorCode = (value: unknown): AssistantErrorCode =>
  typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value)
    ? (value as AssistantErrorCode)
    : 'unknown';

export interface HttpAssistantGatewayOptions {
  endpoint: string;
  /** Raw Telegram initData; verified server-side, never parsed for trust here. */
  initData: () => string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Talks to SYO's own endpoint over HTTPS.
 *
 * Everything sensitive travels in the body or in a header — never in the URL,
 * because query strings end up in logs, proxies and browser history.
 */
export class HttpAssistantGateway implements AssistantGateway {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpAssistantGatewayOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async send(request: AssistantRequest): Promise<AssistantResult> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new AssistantError('offline');
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? ASSISTANT_TIMEOUT_MS,
    );
    request.signal?.addEventListener('abort', () => controller.abort(), { once: true });

    try {
      const response = await this.fetchImpl(this.options.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // The whole initData string, unmodified: the backend re-computes the
          // hash over it and rejects anything it cannot verify.
          'X-Telegram-Init-Data': this.options.initData(),
        },
        body: JSON.stringify(toPayload(request)),
        signal: controller.signal,
      });

      if (!response.ok) throw await toError(response);
      return parseResult(await response.json(), request);
    } catch (error) {
      if (error instanceof AssistantError) throw error;
      if (isAbort(error)) {
        throw new AssistantError(request.signal?.aborted ? 'cancelled' : 'timeout');
      }
      // A network failure is the same story as being offline: nothing was lost.
      throw new AssistantError('offline');
    } finally {
      clearTimeout(timeout);
    }
  }
}

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException ? error.name === 'AbortError' : false;

/** Only what the operation genuinely needs leaves the device (§29.6). */
const toPayload = (request: AssistantRequest) => ({
  requestId: request.requestId,
  operation: request.operation,
  film: request.film,
  rating: request.rating,
  ...(request.text === undefined ? {} : { text: request.text }),
  ...(request.selection ? { selection: request.selection } : {}),
  ...(request.conversation ? { conversation: request.conversation } : {}),
});

const toError = async (response: Response): Promise<AssistantError> => {
  const retryAfterHeader = Number(response.headers.get('Retry-After'));
  const retryAfter = Number.isFinite(retryAfterHeader) ? retryAfterHeader : undefined;

  if (response.status === 401 || response.status === 403) {
    return new AssistantError('unauthorized');
  }
  if (response.status === 429) return new AssistantError('rateLimited', retryAfter);

  // The body may carry a code; it must never carry a provider message we show.
  const code = await response
    .json()
    .then((body: { error?: { code?: unknown } }) => toErrorCode(body?.error?.code))
    .catch(() => 'unknown' as const);

  if (code !== 'unknown') return new AssistantError(code, retryAfter);
  return new AssistantError(response.status >= 500 ? 'providerUnavailable' : 'unknown', retryAfter);
};

const parseResult = (body: unknown, request: AssistantRequest): AssistantResult => {
  if (typeof body !== 'object' || body === null) throw new AssistantError('unknown');
  const source = body as Record<string, unknown>;

  const promptVersion = typeof source.promptVersion === 'string' ? source.promptVersion : 'unknown';
  // A response for a different request is a stale one, and stale results are
  // never shown as if they answered what the user just asked (§20.5).
  const requestId = typeof source.requestId === 'string' ? source.requestId : request.requestId;

  const question = source.question as Record<string, unknown> | undefined;
  if (question && typeof question.question === 'string') {
    return {
      kind: 'question',
      requestId,
      promptVersion,
      question: {
        questionId:
          typeof question.questionId === 'string' ? question.questionId : `${requestId}:q`,
        question: question.question,
        leadIn: typeof question.leadIn === 'string' ? question.leadIn : null,
        topic: typeof question.topic === 'string' ? question.topic : null,
        suggestFinish: question.suggestFinish === true,
      },
    };
  }

  if (typeof source.text === 'string' && source.text.trim()) {
    return {
      kind: 'text',
      requestId,
      promptVersion,
      operation: request.operation as TextOperation,
      text: source.text,
      changeSummary: typeof source.changeSummary === 'string' ? source.changeSummary : '',
    };
  }

  // An empty result is a failure, not a text: replacing the user's words with
  // nothing is the one outcome that must never reach the editor.
  throw new AssistantError('contentRejected');
};
