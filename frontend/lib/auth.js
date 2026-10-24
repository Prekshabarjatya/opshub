'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api';
import { detachPush } from './push';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api('/api/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const d = await api('/api/auth/login', { method: 'POST', body: { email, password }, auth: false });
    setToken(d.token);
    setUser(d.user);
    return d.user;
  }, []);

  const loginWithLink = useCallback(async (linkToken) => {
    const d = await api('/api/auth/link', { method: 'POST', body: { token: linkToken }, auth: false });
    setToken(d.token);
    setUser(d.user);
    return d.user;
  }, []);

  const logout = useCallback(async () => {
    // Stop this person's alerts on this device (a shared phone must not keep receiving them).
    try {
      await detachPush();
    } catch {
      /* ignore */
    }
    setToken(null);
    setUser(null);
    window.location.assign('/login');
  }, []);

  const value = useMemo(() => ({ user, loading, login, loginWithLink, logout }), [user, loading, login, loginWithLink, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
