/**
 * NFR-SEC-1: CORS allow-list. Only the origins named in CORS_ORIGINS
 * (comma-separated) may call the API from a browser; with the variable unset
 * only the local Vite dev server is allowed. Never a wildcard: the API
 * accepts bearer tokens, and a page on any other origin has no business
 * calling it.
 */
export const DEFAULT_DEV_ORIGINS = ['http://localhost:5173'];

export function corsOrigins(raw: string | undefined): string[] {
  const list = (raw ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (list.includes('*')) {
    throw new Error('CORS_ORIGINS must list explicit origins; "*" is not allowed.');
  }
  return list.length ? list : DEFAULT_DEV_ORIGINS;
}
