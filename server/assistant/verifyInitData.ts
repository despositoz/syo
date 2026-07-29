import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Telegram initData verification (spec §29.4).
 *
 * The client sends the raw string Telegram gave it. Nothing inside it is
 * trusted until the signature over it is checked here — a user id read before
 * verification is just a number someone typed.
 */

export interface VerifiedUser {
  userId: string;
  authDate: number;
}

export type InitDataFailure = 'missing' | 'malformed' | 'badSignature' | 'expired';

export interface VerifyOptions {
  botToken: string;
  /** How old initData may be. Telegram recommends a short window. */
  maxAgeSeconds?: number;
  now?: () => number;
}

const DEFAULT_MAX_AGE = 24 * 60 * 60;

/**
 * Returns the verified user, or a reason. Never throws with the data in the
 * message: initData contains the user's name and must not reach a log.
 */
export const verifyInitData = (
  initData: string,
  options: VerifyOptions,
): { ok: true; user: VerifiedUser } | { ok: false; reason: InitDataFailure } => {
  if (!initData) return { ok: false, reason: 'missing' };
  if (!options.botToken) return { ok: false, reason: 'badSignature' };

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'malformed' };

  // The hash itself is not part of what was signed.
  params.delete('hash');
  const checkString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(options.botToken).digest();
  const expected = createHmac('sha256', secret).update(checkString).digest('hex');

  // Constant time: a length-dependent early exit leaks the hash byte by byte.
  const provided = Buffer.from(hash, 'hex');
  const computed = Buffer.from(expected, 'hex');
  if (provided.length !== computed.length) return { ok: false, reason: 'badSignature' };
  if (!timingSafeEqual(provided, computed)) return { ok: false, reason: 'badSignature' };

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate)) return { ok: false, reason: 'malformed' };

  const now = (options.now ?? Date.now)() / 1000;
  const maxAge = options.maxAgeSeconds ?? DEFAULT_MAX_AGE;
  // A signature stays valid forever; the freshness window is what stops a
  // captured initData from being replayed months later.
  if (now - authDate > maxAge) return { ok: false, reason: 'expired' };

  const user = params.get('user');
  if (!user) return { ok: false, reason: 'malformed' };

  try {
    const parsed = JSON.parse(user) as { id?: unknown };
    if (typeof parsed.id !== 'number') return { ok: false, reason: 'malformed' };
    return { ok: true, user: { userId: String(parsed.id), authDate } };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
};
