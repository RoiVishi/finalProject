/**
 * Post-login destination. Only same-site relative paths are accepted, so a
 * crafted ?next=https://evil.example or ?next=//evil.example cannot turn the
 * login page into an open redirect.
 */
export function safeNext(next) {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}

/** Paths that never require a session. */
export const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/reset-password'];

export function isPublicPath(pathname) {
  return PUBLIC_PATHS.includes(pathname);
}

/** /invitations/<token> -> token, else null (AUTH-4 link sent by the backend). */
export function invitationToken(pathname) {
  const m = /^\/invitations\/([A-Za-z0-9_-]+)\/?$/.exec(pathname);
  return m ? m[1] : null;
}
