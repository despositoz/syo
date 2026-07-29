/**
 * The model provider call (spec §29.2).
 *
 * The only file that knows the provider exists. The key is read from the
 * environment at call time and never returned, logged or echoed.
 */

export interface ProviderResult {
  /** Raw JSON text the model produced; parsed by the caller. */
  content: string;
}

export class ProviderError extends Error {
  constructor(
    readonly status: number,
    readonly retriable: boolean,
  ) {
    // Deliberately empty of detail: the provider's message may quote the prompt.
    super(`provider:${status}`);
    this.name = 'ProviderError';
  }
}

export interface ProviderOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-5';

export const callProvider = async (
  prompt: { system: string; user: string },
  options: ProviderOptions,
): Promise<ProviderResult> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 25_000);

  try {
    const response = await fetchImpl(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': options.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: options.model ?? DEFAULT_MODEL,
        max_tokens: options.maxTokens ?? 2000,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // 429 and 5xx are worth another try; the rest are not.
      throw new ProviderError(response.status, response.status === 429 || response.status >= 500);
    }

    const body = (await response.json()) as { content?: { type?: string; text?: string }[] };
    const content = (body.content ?? [])
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');

    if (!content.trim()) throw new ProviderError(502, true);
    return { content };
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Reads the model's JSON out of whatever it wrapped it in. A model that adds a
 * sentence around valid JSON must not cost the user their request.
 */
export const parseModelJson = (content: string): Record<string, unknown> | null => {
  const direct = tryParse(content);
  if (direct) return direct;

  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return tryParse(content.slice(start, end + 1));
};

const tryParse = (value: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
