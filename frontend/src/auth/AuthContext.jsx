import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { createApiClient } from '../api/client.js';
import { authApi } from '../api/auth.js';
import { decodeToken, isExpired, tokenStore } from './token.js';

/**
 * AUTH-1: session state for the whole app. Holds the JWT issued by the backend
 * (12 h expiry, set in AuthModule), exposes the decoded user and one shared API
 * client that every later screen (projects, tasks, Twin data) should use.
 */
const AuthContext = createContext(null);

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function initialSession() {
  const token = tokenStore.get();
  const claims = decodeToken(token);
  if (!token || !claims || isExpired(claims)) {
    if (token) tokenStore.clear();
    return { token: null, user: null, expired: Boolean(token) };
  }
  return { token, user: claims, expired: false };
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(initialSession);
  const tokenRef = useRef(session.token);

  const setToken = useCallback((token) => {
    const claims = decodeToken(token);
    if (!claims) throw new Error('invalid token from server');
    tokenStore.set(token);
    tokenRef.current = token;
    setSession({ token, user: claims, expired: false });
  }, []);

  const logout = useCallback((reason) => {
    tokenStore.clear();
    tokenRef.current = null;
    setSession({ token: null, user: null, expired: reason === 'expired' });
  }, []);

  const client = useMemo(
    () =>
      createApiClient({
        baseUrl: API_BASE,
        getToken: () => tokenRef.current,
        onUnauthorized: () => logout('expired'),
      }),
    [logout],
  );
  const api = useMemo(() => authApi(client), [client]);

  const value = useMemo(
    () => ({
      user: session.user,
      isAuthenticated: Boolean(session.token),
      sessionExpired: session.expired,
      client,
      async login(email, password) {
        const { access_token } = await api.login(email, password);
        setToken(access_token);
      },
      async register(form) {
        const { access_token } = await api.register(form);
        setToken(access_token);
      },
      requestPasswordReset: api.requestPasswordReset,
      confirmPasswordReset: api.confirmPasswordReset,
      logout: () => logout(),
    }),
    [session, client, api, setToken, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
