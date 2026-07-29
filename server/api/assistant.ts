import { environmentFrom, handleAssistantRequest } from '../assistant/handler';

/**
 * Deployment wrapper.
 *
 * Vercel, Netlify and Cloudflare all hand a web-standard Request to a default
 * export, so this file is the whole adapter. CORS is deliberately narrow: only
 * the Mini App's own origin may call it.
 */

const allowedOrigin = process.env.ASSISTANT_ALLOWED_ORIGIN ?? '';

const corsHeaders = (origin: string | null): Record<string, string> => {
  if (!allowedOrigin || origin !== allowedOrigin) return {};
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
};

export default async function handler(request: Request): Promise<Response> {
  const origin = request.headers.get('Origin');
  const headers = corsHeaders(origin);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  const response = await handleAssistantRequest(request, environmentFrom(process.env));
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  // The answer depends on who asked; a shared cache must never serve it twice.
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export const config = { runtime: 'edge' };
