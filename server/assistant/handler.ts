import { buildPrompt, PROMPT_VERSIONS, type Operation, type PromptContext } from './prompts';
import { callProvider, parseModelJson, ProviderError } from './provider';
import { verifyInitData } from './verifyInitData';

/**
 * SYO's assistant endpoint (spec §29).
 *
 * Web-standard Request/Response, so the same handler runs on Vercel, Deno,
 * Bun, Cloudflare Workers and a plain Node server. What it guarantees:
 *
 *  — the provider key never leaves this process;
 *  — no request is served without a verified Telegram signature;
 *  — no review text, answer or model output is ever logged.
 */

const OPERATIONS: readonly Operation[] = [
  'nextQuestion',
  'replaceQuestion',
  'collect',
  'correct',
  'shorten',
  'connect',
];

/** Guards against a client sending a novel to be "shortened". */
const MAX_TEXT = 30_000;
const MAX_ANSWER = 4_000;
const MAX_TURNS = 12;

export interface HandlerEnvironment {
  botToken: string;
  apiKey: string;
  model?: string;
  /** Requests per user per window. */
  rateLimit?: number;
  rateWindowMs?: number;
  initDataMaxAgeSeconds?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Structured, content-free. Defaults to console.info. */
  log?: (event: Record<string, unknown>) => void;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const errorResponse = (code: string, status: number, retryAfter?: number): Response =>
  json({ error: { code } }, status, retryAfter ? { 'Retry-After': String(retryAfter) } : {});

/**
 * Per-user sliding window, in memory. It holds for a single instance, which is
 * what a Mini App this size runs on; behind several instances this becomes a
 * per-instance limit and wants a shared store (Redis, Durable Object).
 */
const buckets = new Map<string, number[]>();

const withinRateLimit = (userId: string, limit: number, windowMs: number, now: number): boolean => {
  const recent = (buckets.get(userId) ?? []).filter((at) => now - at < windowMs);
  if (recent.length >= limit) {
    buckets.set(userId, recent);
    return false;
  }
  recent.push(now);
  buckets.set(userId, recent);
  return true;
};

/** Exported for tests: the limiter must start from a known state. */
export const resetRateLimits = (): void => buckets.clear();

interface RequestBody {
  requestId?: unknown;
  operation?: unknown;
  film?: { filmId?: unknown; title?: unknown; year?: unknown };
  rating?: {
    mode?: unknown;
    overallRating?: unknown;
    preciseRating?: unknown;
    aspects?: unknown;
  };
  text?: unknown;
  selection?: { start?: unknown; end?: unknown };
  conversation?: {
    sessionId?: unknown;
    turns?: unknown;
    askedQuestionIds?: unknown;
    topics?: unknown;
  };
}

const toContext = (body: RequestBody): PromptContext | null => {
  const title = body.film?.title;
  const rating = body.rating;
  if (typeof title !== 'string' || !title) return null;
  if (typeof rating?.overallRating !== 'number') return null;

  const turns = Array.isArray(body.conversation?.turns)
    ? (body.conversation.turns as { questionText?: unknown; answerText?: unknown }[])
        .slice(0, MAX_TURNS)
        .map((turn) => ({
          questionText: typeof turn.questionText === 'string' ? turn.questionText : '',
          answerText:
            typeof turn.answerText === 'string' ? turn.answerText.slice(0, MAX_ANSWER) : null,
        }))
    : [];

  return {
    film: {
      title: title.slice(0, 200),
      year: typeof body.film?.year === 'string' ? body.film.year : null,
    },
    rating: {
      mode: rating.mode === 'deep' ? 'deep' : 'quick',
      overallRating: rating.overallRating,
      preciseRating:
        typeof rating.preciseRating === 'number' ? rating.preciseRating : rating.overallRating,
      ...(rating.aspects && typeof rating.aspects === 'object'
        ? { aspects: rating.aspects as Record<string, number | null> }
        : {}),
    },
    ...(typeof body.text === 'string' ? { text: body.text.slice(0, MAX_TEXT) } : {}),
    ...(body.conversation
      ? {
          conversation: {
            turns,
            askedQuestionIds: Array.isArray(body.conversation.askedQuestionIds)
              ? (body.conversation.askedQuestionIds as string[]).filter(
                  (id) => typeof id === 'string',
                )
              : [],
            topics: Array.isArray(body.conversation.topics)
              ? (body.conversation.topics as string[]).filter((topic) => typeof topic === 'string')
              : [],
          },
        }
      : {}),
  };
};

export const handleAssistantRequest = async (
  request: Request,
  environment: HandlerEnvironment,
): Promise<Response> => {
  // eslint-disable-next-line no-console -- structured, content-free server log
  const log = environment.log ?? ((event) => console.log(JSON.stringify(event)));
  const now = (environment.now ?? Date.now)();
  const startedAt = now;

  if (request.method !== 'POST') return errorResponse('invalidRequest', 405);

  const verified = verifyInitData(request.headers.get('X-Telegram-Init-Data') ?? '', {
    botToken: environment.botToken,
    ...(environment.initDataMaxAgeSeconds === undefined
      ? {}
      : { maxAgeSeconds: environment.initDataMaxAgeSeconds }),
    now: () => now,
  });
  if (!verified.ok) {
    // The reason is logged; the initData itself never is.
    log({ event: 'assistant.rejected', reason: verified.reason });
    return errorResponse('unauthorized', 401);
  }

  const windowMs = environment.rateWindowMs ?? 60_000;
  if (!withinRateLimit(verified.user.userId, environment.rateLimit ?? 20, windowMs, now)) {
    return errorResponse('rateLimited', 429, Math.ceil(windowMs / 1000));
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return errorResponse('invalidRequest', 400);
  }

  const operation = body.operation;
  if (typeof operation !== 'string' || !(OPERATIONS as readonly string[]).includes(operation)) {
    return errorResponse('invalidRequest', 400);
  }
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  if (!requestId) return errorResponse('invalidRequest', 400);

  const context = toContext(body);
  if (!context) return errorResponse('invalidRequest', 400);

  const promptOperation = operation as Operation;
  const prompt = buildPrompt(promptOperation, context);

  try {
    const result = await callProvider(prompt, {
      apiKey: environment.apiKey,
      ...(environment.model ? { model: environment.model } : {}),
      ...(environment.fetchImpl ? { fetchImpl: environment.fetchImpl } : {}),
    });

    const parsed = parseModelJson(result.content);
    if (!parsed) return errorResponse('contentRejected', 422);

    const promptVersion = PROMPT_VERSIONS[promptOperation];

    // Counts and durations only: never the question, never the text.
    log({
      event: 'assistant.ok',
      requestId,
      operation,
      promptVersion,
      durationMs: (environment.now ?? Date.now)() - startedAt,
    });

    if (prompt.expects === 'question') {
      const question = parsed.question;
      if (typeof question !== 'string' || !question.trim()) {
        return errorResponse('contentRejected', 422);
      }
      return json({
        requestId,
        promptVersion,
        question: {
          questionId: `${requestId}:${Date.now()}`,
          question,
          leadIn: typeof parsed.leadIn === 'string' ? parsed.leadIn : null,
          topic: typeof parsed.topic === 'string' ? parsed.topic : null,
          suggestFinish: parsed.suggestFinish === true,
        },
      });
    }

    const text = parsed.text;
    // An empty result would replace the user's words with nothing.
    if (typeof text !== 'string' || !text.trim()) return errorResponse('contentRejected', 422);

    return json({
      requestId,
      promptVersion,
      text: text.slice(0, MAX_TEXT),
      changeSummary: typeof parsed.changeSummary === 'string' ? parsed.changeSummary : '',
    });
  } catch (error) {
    const retriable = error instanceof ProviderError ? error.retriable : true;
    log({
      event: 'assistant.failed',
      requestId,
      operation,
      status: error instanceof ProviderError ? error.status : 0,
    });
    return errorResponse('providerUnavailable', retriable ? 503 : 502);
  }
};

/** Reads the environment once, so a missing variable fails loudly at start. */
export const environmentFrom = (source: Record<string, string | undefined>): HandlerEnvironment => {
  const botToken = source.TELEGRAM_BOT_TOKEN;
  const apiKey = source.ASSISTANT_API_KEY;
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is required');
  if (!apiKey) throw new Error('ASSISTANT_API_KEY is required');

  return {
    botToken,
    apiKey,
    ...(source.ASSISTANT_MODEL ? { model: source.ASSISTANT_MODEL } : {}),
    ...(source.ASSISTANT_RATE_LIMIT ? { rateLimit: Number(source.ASSISTANT_RATE_LIMIT) } : {}),
  };
};
