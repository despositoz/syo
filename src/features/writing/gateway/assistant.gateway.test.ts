import { describe, expect, it } from 'vitest';
import { AssistantError, HttpAssistantGateway, type AssistantRequest } from './assistant.gateway';

const request = (overrides: Partial<AssistantRequest> = {}): AssistantRequest => ({
  requestId: 'req-1',
  operation: 'correct',
  film: { filmId: 7, title: 'Фильм', year: '2024' },
  rating: { mode: 'quick', overallRating: 4, preciseRating: 4 },
  text: 'Текст',
  ...overrides,
});

const gateway = (fetchImpl: typeof fetch, initData = 'user=1&hash=abc') =>
  new HttpAssistantGateway({
    endpoint: 'https://syo.example/api/assistant',
    initData: () => initData,
    fetchImpl,
  });

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe('talking to SYO’s own backend', () => {
  it('sends the payload in the body and initData in a header', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const sut = gateway((async (url: string, init: RequestInit) => {
      seenUrl = url;
      seenInit = init;
      return jsonResponse({ requestId: 'req-1', promptVersion: 'correct-1', text: 'Исправлено' });
    }) as unknown as typeof fetch);

    await sut.send(request());

    // Nothing sensitive in the URL: query strings end up in logs and history.
    expect(seenUrl).toBe('https://syo.example/api/assistant');
    expect(seenUrl).not.toContain('Текст');
    expect((seenInit?.headers as Record<string, string>)['X-Telegram-Init-Data']).toBe(
      'user=1&hash=abc',
    );
    expect(String(seenInit?.body)).toContain('Текст');
  });

  it('returns the text result with its prompt version', async () => {
    const sut = gateway((async () =>
      jsonResponse({
        requestId: 'req-1',
        promptVersion: 'correct-1',
        text: 'Исправлено',
        changeSummary: 'Поправил опечатки',
      })) as unknown as typeof fetch);

    const result = await sut.send(request());

    expect(result).toMatchObject({
      kind: 'text',
      text: 'Исправлено',
      promptVersion: 'correct-1',
      changeSummary: 'Поправил опечатки',
    });
  });

  it('returns a question when one is asked for', async () => {
    const sut = gateway((async () =>
      jsonResponse({
        requestId: 'req-1',
        promptVersion: 'question-1',
        question: { questionId: 'q1', question: 'Что зацепило?', suggestFinish: false },
      })) as unknown as typeof fetch);

    const result = await sut.send(request({ operation: 'nextQuestion' }));
    expect(result).toMatchObject({ kind: 'question', question: { question: 'Что зацепило?' } });
  });

  it('treats an empty text as a failure, never as a result', async () => {
    const sut = gateway((async () =>
      jsonResponse({ requestId: 'req-1', text: '   ' })) as unknown as typeof fetch);

    await expect(sut.send(request())).rejects.toMatchObject({ code: 'contentRejected' });
  });

  it('maps an unauthorized answer to a code the UI can speak about', async () => {
    const sut = gateway((async () => jsonResponse({}, 401)) as unknown as typeof fetch);
    await expect(sut.send(request())).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('passes the retry delay through on a rate limit', async () => {
    const sut = gateway((async () =>
      jsonResponse({ error: { code: 'rateLimited' } }, 429, {
        'Retry-After': '30',
      })) as unknown as typeof fetch);

    await expect(sut.send(request())).rejects.toMatchObject({
      code: 'rateLimited',
      retryAfter: 30,
    });
  });

  it('turns a network failure into "offline", not into a crash', async () => {
    const sut = gateway((async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch);

    const error = await sut.send(request()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AssistantError);
    expect((error as AssistantError).code).toBe('offline');
    expect((error as AssistantError).retriable).toBe(true);
  });

  it('reports a cancellation as the user’s own doing', async () => {
    const controller = new AbortController();
    const sut = gateway((async (_url: string, init: RequestInit) => {
      // The user walks away mid-request: the gateway's own signal aborts too.
      controller.abort();
      if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return jsonResponse({ requestId: 'req-1', text: 'ok' });
    }) as unknown as typeof fetch);

    await expect(sut.send(request({ signal: controller.signal }))).rejects.toMatchObject({
      code: 'cancelled',
    });
  });

  it('never carries anything secret: the payload is only what the operation needs', async () => {
    let sentBody = '';
    const sut = gateway((async (_url: string, init: RequestInit) => {
      sentBody = String(init.body);
      return jsonResponse({ requestId: 'req-1', text: 'ok' });
    }) as unknown as typeof fetch);

    await sut.send(request());
    const payload = JSON.parse(sentBody) as Record<string, unknown>;

    expect(Object.keys(payload).sort()).toEqual(
      ['film', 'operation', 'rating', 'requestId', 'text'].sort(),
    );
  });
});
