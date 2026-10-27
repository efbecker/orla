/*
 * API client. The access token lives only in memory; the refresh token is an
 * httpOnly cookie scoped to /api/auth. A 401 triggers one shared refresh and a
 * single retry of the original request.
 */

export interface FieldIssue {
  path: string;
  message: string;
}

export interface NginxDiagnostic {
  level: string;
  message: string;
  file?: string;
  line?: number;
  source?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Field-level validation issues (400 responses from Zod). */
  get issues(): FieldIssue[] {
    if (!Array.isArray(this.details)) return [];
    return this.details.filter(
      (item): item is FieldIssue => typeof item === "object" && item !== null && "path" in item && "message" in item,
    );
  }

  /** `nginx -t` diagnostics (422 NGINX_TEST_FAILED). */
  get diagnostics(): NginxDiagnostic[] {
    if (this.code !== "NGINX_TEST_FAILED" || typeof this.details !== "object" || this.details === null) return [];
    const list = (this.details as { diagnostics?: unknown }).diagnostics;
    return Array.isArray(list) ? (list as NginxDiagnostic[]) : [];
  }
}

export interface Session {
  accessToken: string;
  user: User;
}

export interface User {
  id: number;
  email: string;
  name: string;
  role: "ADMIN" | "EDITOR" | "VIEWER";
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
}

let accessToken: string | null = null;
let refreshing: Promise<Session | null> | null = null;
let onSessionLost: (() => void) | null = null;
let onSessionRefreshed: ((session: Session) => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setSessionListeners(listeners: { lost: () => void; refreshed: (session: Session) => void }): void {
  onSessionLost = listeners.lost;
  onSessionRefreshed = listeners.refreshed;
}

function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const search = params.toString();
  return `/api${path}${search ? `?${search}` : ""}`;
}

async function toApiError(response: Response): Promise<ApiError> {
  let payload: { error?: string; message?: string; details?: unknown } = {};
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    // Non-JSON error page (proxy or network): keep the generic message.
  }
  const fallback = response.status >= 500 ? "O servidor encontrou um erro." : `Falha na requisição (${response.status}).`;
  return new ApiError(response.status, payload.error ?? "HTTP_ERROR", payload.message ?? fallback, payload.details);
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  try {
    return await fetch(buildUrl(path, options.query), {
      method: options.method ?? "GET",
      headers,
      body,
      credentials: "same-origin",
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "NETWORK_ERROR", "Não foi possível conectar ao painel. Verifique a conexão.");
  }
}

/** Exchanges the refresh cookie for a new access token (shared between callers). */
export function refreshSession(): Promise<Session | null> {
  refreshing ??= (async () => {
    try {
      const response = await fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" });
      if (!response.ok) return null;
      const session = (await response.json()) as Session;
      accessToken = session.accessToken;
      onSessionRefreshed?.(session);
      return session;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, options);
  if (response.status === 401 && !path.startsWith("/auth/")) {
    const session = await refreshSession();
    if (!session) {
      accessToken = null;
      onSessionLost?.();
      throw await toApiError(response);
    }
    response = await send(path, options);
  }
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const first = error.issues[0];
    if (first && error.message === "Dados inválidos.") return `${error.message} ${first.message}`;
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Erro inesperado.";
}
