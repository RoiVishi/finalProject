import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { he } from '../i18n/he.js';
import { Link, navigate } from '../router.jsx';
import './app.css';

/** Frame for the signed-in screens (home, wizard, project). The Twin keeps its own layout. */
export function AppShell({ children, actions }) {
  const { user, logout } = useAuth();
  return (
    <div className="shell" dir="rtl">
      <header className="shell-header">
        <Link to="/" className="shell-brand">
          <div className="logo-mark" aria-hidden="true">🏗️</div>
          <div>
            <div className="app-title">{he.app.name}</div>
            <div className="app-subtitle">{he.app.tagline}</div>
          </div>
        </Link>
        <nav className="shell-nav">
          {actions}
          <Link to="/twin" className="shell-link">{he.home.twinDemo}</Link>
          {user && <span className="shell-user" dir="ltr">{user.email}</span>}
          <button className="shell-logout" onClick={() => { logout(); navigate('/login', { replace: true }); }}>
            {he.common.logout}
          </button>
        </nav>
      </header>
      <main className="shell-main">{children}</main>
    </div>
  );
}

/** Minimal data hook: { data, error, loading, reload }. error is the ApiError message list. */
export function useApi(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    run().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (e) => live && setState({ data: null, error: e?.messages ?? [he.errors.generic], loading: false, status: e?.status }),
    );
    return () => { live = false; };
  }, [run, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : '—';
}
