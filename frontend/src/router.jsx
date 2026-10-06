/**
 * Minimal pathname router (no dependency). Enough for the auth flow and the
 * links the backend e-mails out (/reset-password?token=…, /invitations/:token).
 * Can be swapped for react-router later without touching the pages: they only
 * use navigate() and the <Link> component.
 */
import React, { useEffect, useState } from 'react';

const EVT = 'foresite:navigate';

export function navigate(to, { replace = false } = {}) {
  if (replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(EVT));
}

export function useLocation() {
  const read = () => ({ pathname: window.location.pathname, search: window.location.search });
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const on = () => setLoc(read());
    window.addEventListener('popstate', on);
    window.addEventListener(EVT, on);
    // Child effects run before this one, so a <Redirect> rendered on the first
    // pass may already have navigated before we subscribed: re-read once.
    on();
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener(EVT, on);
    };
  }, []);
  return loc;
}

export function Link({ to, children, ...rest }) {
  return (
    <a
      href={to}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
