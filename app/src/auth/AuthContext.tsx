/** Keeps the JWT in localStorage and exposes login/register/logout. The server re-checks the role on every call. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthResponse, UserView } from "@esp32cam/shared";
import { configureApi, get, post } from "../api/client";

const TOKEN_KEY = "homesec.token";

interface AuthState {
  user: UserView | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(body: { email: string; password: string; setupCode?: string; inviteCode?: string; householdName?: string }): Promise<void>;
  logout(): void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<UserView | null>(null);
  const [loading, setLoading] = useState(!!token);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    configureApi({ getToken: () => localStorage.getItem(TOKEN_KEY), onUnauthorized: logout });
  }, [logout]);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    let cancelled = false;
    get<{ userId: string; email: string; householdId: string; role: UserView["role"] }>("me")
      .then((p) => { if (!cancelled) setUser({ id: p.userId, email: p.email, householdId: p.householdId, role: p.role }); })
      .catch(() => { if (!cancelled) logout(); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, logout]);

  const accept = (res: AuthResponse) => {
    localStorage.setItem(TOKEN_KEY, res.token);
    setToken(res.token);
    setUser(res.user);
  };

  const value = useMemo<AuthState>(() => ({
    user,
    loading,
    login: async (email, password) => accept(await post<AuthResponse>("auth/login", { email, password })),
    register: async (body) => accept(await post<AuthResponse>("auth/register", body)),
    logout,
  }), [user, loading, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
