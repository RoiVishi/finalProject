/**
 * Signed-in routes. Pure so it can be unit-tested; Root.jsx renders the match.
 *   /                 home (project cards)
 *   /projects/new     project wizard
 *   /projects/:id     project page
 *   /twin             the existing Twin + AR demo (App.jsx, unchanged)
 */
export function matchAppRoute(pathname) {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/') return { name: 'home' };
  if (p === '/projects/new') return { name: 'wizard' };
  if (p === '/twin') return { name: 'twin' };
  const m = /^\/projects\/([0-9a-fA-F-]{8,64})$/.exec(p);
  if (m) return { name: 'project', id: m[1] };
  return { name: 'notFound' };
}
