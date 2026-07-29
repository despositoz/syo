import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { handleAssistantRequest, resetRateLimits } from './handler';
import { verifyInitData } from './verifyInitData';

const BOT_TOKEN = '123456:test-token';
const NOW = Date.parse('2026-07-29T12:00:00.000Z');

/** Builds initData the way Telegram does, so the check is a real check. */
const signInitData = (
  fields: Record<string, string>,
  token = BOT_TOKEN,
): string => {
  const checkString = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(checkString).digest('hex');

  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
};

const validInitData = (overrides: Record<string, string> = {}) =>
  signInitData({
    auth_date: String(Math.floor(NOW / 1000) - 30),
    user: JSON.stringify({ id: 42, first_name: 'Тест' }),
    ...overrides,
  });

const body = (overrides: Record<string, unknown> = {}) => ({
  requestId: 'req-1',
  operation: 'correct',
  film: { filmId: 7, title: 'Фильм', year: '2024' },
  rating: { mode: 'quick', overallRating: 4, preciseRating: 4 },
  text: 'Текст с ашипкой',
  ...overrides,
});

const request = (init: { initData?: string; payload?: unknown; method?: string } = {}) =>
  new Request('https://syo.example/api/assistant', {
    method: init.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': init.initData ?? validInitData(),
    },
    ...(init.method === 'GET' ? {} : { body: JSON.stringify(init.payload ?? body()) }),
  });

/** A provider that answers instantly, so nothing here touches the network. */
const fetchStub = (result: Record<string, unknown>, status = 200): typeof fetch =>
  (async () =>
    new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(result) }] }), {
      status,
    })) as unknown as typeof fetch;

const environment = (overrides: Record<string, unknown> = {}) => ({
  botToken: BOT_TOKEN,
  apiKey: 'never-leaves-the-server',
  fetchImpl: fetchStub({ text: 'Текст с ошибкой', changeSummary: 'Поправил опечатку' }),
  now: () => NOW,
  log: () => {},
  ...overrides,
});

beforeEach(() => {
  resetRateLimits();
});

describe('initData verification', () => {
  it('accepts data signed with the bot token', () => {
    const result = verifyInitData(validInitData(), { botToken: BOT_TOKEN, now: () => NOW });
    expect(result).toMatchObject({ ok: true, user: { userId: '42' } });
  });

  it('rejects data signed with a different token', () => {
    const forged = signInitData(
      { auth_date: String(Math.floor(NOW / 1000)), user: JSON.stringify({ id: 42 }) },
      'attacker-token',
    );
    expect(verifyInitData(forged, { botToken: BOT_TOKEN, now: () => NOW })).toMatchObject({
      ok: false,
      reason: 'badSignature',
    });
  });

  it('rejects a tampered field even though the hash is present', () => {
    const tampered = validInitData().replace('%22id%22%3A42', '%22id%22%3A999');
    expect(verifyInitData(tampered, { botToken: BOT_TOKEN, now: () => NOW }).ok).toBe(false);
  });

  it('rejects initData older than the window', () => {
    const old = signInitData({
      auth_date: String(Math.floor(NOW / 1000) - 60 * 60 * 48),
      user: JSON.stringify({ id: 42 }),
    });
    expect(verifyInitData(old, { botToken: BOT_TOKEN, now: () => NOW })).toMatchObject({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects an empty string', () => {
    expect(verifyInitData('', { botToken: BOT_TOKEN }).ok).toBe(false);
  });
});

describe('the endpoint', () => {
  it('serves a verified request', async () => {
    const response = await handleAssistantRequest(request(), environment());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.text).toBe('Текст с ошибкой');
    expect(payload.promptVersion).toBe('correct-1');
    expect(payload.requestId).toBe('req-1');
  });

  it('refuses an unsigned request without calling the provider', async () => {
    let called = false;
    const response = await handleAssistantRequest(
      request({ initData: 'user=%7B%22id%22%3A42%7D&hash=deadbeef' }),
      environment({
        fetchImpl: (async () => {
          called = true;
          return new Response('{}');
        }) as unknown as typeof fetch,
      }),
    );

    expect(response.status).toBe(401);
    expect(called).toBe(false);
  });

  it('refuses an unknown operation', async () => {
    const response = await handleAssistantRequest(
      request({ payload: body({ operation: 'deleteEverything' }) }),
      environment(),
    );
    expect(response.status).toBe(400);
  });

  it('rate limits per user and says how long to wait', async () => {
    const env = environment({ rateLimit: 2, rateWindowMs: 60_000 });
    await handleAssistantRequest(request(), env);
    await handleAssistantRequest(request(), env);

    const third = await handleAssistantRequest(request(), env);
    expect(third.status).toBe(429);
    expect(third.headers.get('Retry-After')).toBe('60');
  });

  it('never turns an empty model answer into an empty text', async () => {
    const response = await handleAssistantRequest(
      request(),
      environment({ fetchImpl: fetchStub({ text: '   ' }) }),
    );
    expect(response.status).toBe(422);
  });

  it('reports the provider being down without leaking its message', async () => {
    const response = await handleAssistantRequest(
      request(),
      environment({
        fetchImpl: (async () =>
          new Response('Rate limit for key sk-ant-...', { status: 500 })) as unknown as typeof fetch,
      }),
    );

    expect(response.status).toBe(503);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe('providerUnavailable');
    expect(JSON.stringify(payload)).not.toContain('sk-ant');
  });

  it('logs the outcome without a single word of the text', async () => {
    const events: Record<string, unknown>[] = [];
    await handleAssistantRequest(request(), environment({ log: (event: Record<string, unknown>) => events.push(event) }));

    const serialized = JSON.stringify(events);
    expect(serialized).toContain('assistant.ok');
    expect(serialized).not.toContain('ашипкой');
    expect(serialized).not.toContain('Текст с ошибкой');
    // Nor the user's identity, nor the signature.
    expect(serialized).not.toContain('hash');
  });

  it('never sends the api key back to the client', async () => {
    const response = await handleAssistantRequest(request(), environment());
    const raw = await response.text();
    expect(raw).not.toContain('never-leaves-the-server');
  });
});

describe('what reaches the provider', () => {
  it('carries the film, the rating and the text — and nothing else', async () => {
    let sent = '';
    await handleAssistantRequest(
      request(),
      environment({
        fetchImpl: (async (_url: string, init: RequestInit) => {
          sent = String(init.body);
          return new Response(
            JSON.stringify({ content: [{ type: 'text', text: '{"text":"ok"}' }] }),
          );
        }) as unknown as typeof fetch,
      }),
    );

    expect(sent).toContain('Фильм');
    expect(sent).toContain('Текст с ашипкой');
    // The signature and the user id are the server's business alone.
    expect(sent).not.toContain('hash=');
    expect(sent).not.toContain('auth_date');
  });

  it('caps a text far beyond the limit instead of forwarding it whole', async () => {
    let sent = '';
    await handleAssistantRequest(
      request({ payload: body({ text: 'а'.repeat(100_000) }) }),
      environment({
        fetchImpl: (async (_url: string, init: RequestInit) => {
          sent = String(init.body);
          return new Response(
            JSON.stringify({ content: [{ type: 'text', text: '{"text":"ok"}' }] }),
          );
        }) as unknown as typeof fetch,
      }),
    );

    expect(sent.length).toBeLessThan(40_000);
  });
});
