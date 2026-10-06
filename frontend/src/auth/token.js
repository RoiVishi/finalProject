/**
 * JWT helpers. The payload is decoded only to show who is logged in and to drop
 * an expired token early — it is NOT verified here; the backend verifies every
 * request, so nothing security-relevant depends on this decode.
 */
const KEY = 'foresite.token';

function base64UrlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes); // payload may hold Hebrew (UTF-8)
}

/** Returns { userId, email, role, profession, exp } or null for a malformed token. */
export function decodeToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const p = JSON.parse(base64UrlDecode(parts[1]));
    if (!p || typeof p.sub !== 'string') return null;
    return { userId: p.sub, email: p.email, role: p.role, profession: p.profession, exp: p.exp };
  } catch {
    return null;
  }
}

/** True when the token has an exp claim in the past (with a small skew allowance). */
export function isExpired(claims, nowMs = Date.now(), skewSec = 30) {
  if (!claims) return true;
  if (typeof claims.exp !== 'number') return false;
  return claims.exp * 1000 <= nowMs + skewSec * 1000;
}

/** Storage can be unavailable (private mode, blocked site data): fail soft. */
export const tokenStore = {
  get() {
    try { return globalThis.localStorage?.getItem(KEY) ?? null; } catch { return null; }
  },
  set(t) {
    try { globalThis.localStorage?.setItem(KEY, t); } catch { /* session-only */ }
  },
  clear() {
    try { globalThis.localStorage?.removeItem(KEY); } catch { /* nothing to clear */ }
  },
};
