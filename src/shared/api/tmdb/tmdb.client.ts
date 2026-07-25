import type { z } from 'zod';

/**
 * The only module that knows how a TMDB request is shaped.
 * Pages and components never build a TMDB URL.
 */

export class TmdbError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: 'network' | 'http' | 'schema' | 'config',
  ) {
    super(message);
    this.name = 'TmdbError';
  }
}

export interface TmdbClientConfig {
  apiBase: string;
  imageBase: string;
  apiKey: string;
  accessToken: string;
  language: string;
  timeoutMs: number;
}

const env = import.meta.env ?? {};

export const tmdbConfig: TmdbClientConfig = {
  apiBase: env.VITE_TMDB_API_BASE || 'https://api.themoviedb.org/3',
  imageBase: env.VITE_TMDB_IMAGE_BASE || 'https://image.tmdb.org/t/p',
  apiKey: env.VITE_TMDB_API_KEY || '',
  accessToken: env.VITE_TMDB_ACCESS_TOKEN || '',
  language: env.VITE_TMDB_LANGUAGE || 'ru-RU',
  timeoutMs: 9000,
};

export const isTmdbConfigured = (config: TmdbClientConfig = tmdbConfig): boolean =>
  Boolean(config.apiKey || config.accessToken);

export interface TmdbRequestOptions {
  signal?: AbortSignal;
  /** Extra query parameters, already decoded. */
  query?: Record<string, string | number | boolean | undefined>;
}

const buildUrl = (path: string, options: TmdbRequestOptions, config: TmdbClientConfig): string => {
  const url = new URL(`${config.apiBase}${path}`);
  url.searchParams.set('language', config.language);
  Object.entries(options.query ?? {}).forEach(([key, value]) => {
    if (value === undefined || value === '') return;
    url.searchParams.set(key, String(value));
  });
  if (!config.accessToken && config.apiKey) url.searchParams.set('api_key', config.apiKey);
  return url.toString();
};

/** Combines a caller signal with our own timeout without losing either. */
const withTimeout = (signal: AbortSignal | undefined, timeoutMs: number) => {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('timeout', 'TimeoutError')),
    timeoutMs,
  );
  const abort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    },
  };
};

export class TmdbClient {
  constructor(
    private readonly config: TmdbClientConfig = tmdbConfig,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  get imageBase(): string {
    return this.config.imageBase;
  }

  get configured(): boolean {
    return isTmdbConfigured(this.config);
  }

  async request<Schema extends z.ZodTypeAny>(
    path: string,
    schema: Schema,
    options: TmdbRequestOptions = {},
  ): Promise<z.infer<Schema>> {
    if (!this.configured) {
      throw new TmdbError('TMDB token is not configured', 0, 'config');
    }

    const url = buildUrl(path, options, this.config);
    const timeout = withTimeout(options.signal, this.config.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        signal: timeout.signal,
        headers: this.config.accessToken
          ? { Authorization: `Bearer ${this.config.accessToken}`, accept: 'application/json' }
          : { accept: 'application/json' },
      });
    } catch (error) {
      timeout.dispose();
      if (options.signal?.aborted) throw error;
      throw new TmdbError((error as Error)?.message ?? 'network error', 0, 'network');
    } finally {
      timeout.dispose();
    }

    if (!response.ok) {
      throw new TmdbError(`TMDB responded ${response.status}`, response.status, 'http');
    }

    const payload: unknown = await response.json().catch(() => null);
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new TmdbError('Unexpected TMDB payload', response.status, 'schema');
    }
    return parsed.data;
  }
}

export const tmdbClient = new TmdbClient();
