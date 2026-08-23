import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const TOKEN_KEY = 'examplat_token';
const META_KEY = 'examplat_meta';

function readItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readMeta() {
  try {
    return JSON.parse(readItem(META_KEY) || 'null');
  } catch {
    return null;
  }
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => readItem(TOKEN_KEY));
  const [meta, setMeta] = useState(() => readMeta());

  const login = useCallback((payload) => {
    try {
      localStorage.setItem(TOKEN_KEY, payload.token);
      localStorage.setItem(META_KEY, JSON.stringify(payload));
    } catch {
      /* storage unavailable - session lasts for the page life */
    }
    setToken(payload.token);
    setMeta(payload);
  }, []);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(META_KEY);
    } catch {
      /* noop */
    }
    setToken(null);
    setMeta(null);
  }, []);

  const value = useMemo(
    () => ({
      token,
      meta,
      login,
      logout,
      exam: meta?.exam || null,
      candidate: meta?.candidate || null,
    }),
    [token, meta, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}