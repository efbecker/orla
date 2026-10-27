import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, refreshSession, setAccessToken, setSessionListeners, type Session, type User } from "@/lib/api";

type AuthState = { status: "loading"; user: null } | { status: "anonymous"; user: null } | { status: "authenticated"; user: User };

interface AuthContextValue {
  state: AuthState;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (role: User["role"]) => boolean;
}

const RANK: Record<User["role"], number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 };

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });

  useEffect(() => {
    setSessionListeners({
      lost: () => {
        setState({ status: "anonymous", user: null });
        queryClient.clear();
      },
      refreshed: (session) => setState({ status: "authenticated", user: session.user }),
    });
    void refreshSession().then((session) => {
      if (!session) setState({ status: "anonymous", user: null });
    });
  }, [queryClient]);

  const login = useCallback(async (email: string, password: string) => {
    const session = await api<Session>("/auth/login", { method: "POST", body: { email, password } });
    setAccessToken(session.accessToken);
    setState({ status: "authenticated", user: session.user });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      setAccessToken(null);
      setState({ status: "anonymous", user: null });
      queryClient.clear();
    }
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      user: state.user,
      login,
      logout,
      can: (role) => (state.user ? RANK[state.user.role] >= RANK[role] : false),
    }),
    [state, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
