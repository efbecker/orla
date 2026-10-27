import fastifyCookie from "@fastify/cookie";
import fastifyJwt from "@fastify/jwt";
import type { UserRole } from "@prisma/client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { forbidden, unauthorized } from "../lib/http-errors.js";
import type { Actor } from "../services/audit.js";

export interface AccessTokenPayload {
  sub: number;
  email: string;
  role: UserRole;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AccessTokenPayload;
    user: AccessTokenPayload;
  }
}

declare module "fastify" {
  interface FastifyContextConfig {
    /** Route reachable without a token. */
    public?: boolean;
    /** Minimum role; defaults to VIEWER for GET and EDITOR otherwise. */
    role?: UserRole;
    /** Accept ?access_token= (EventSource cannot send headers). */
    queryToken?: boolean;
  }
}

export const ACCESS_TOKEN_TTL = "15m";
export const REFRESH_COOKIE = "orla_refresh";

const RANK: Record<UserRole, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 };

export function hasRole(role: UserRole, required: UserRole): boolean {
  return RANK[role] >= RANK[required];
}

export function actorFrom(request: FastifyRequest): Actor {
  return {
    userId: request.user?.sub ?? null,
    email: request.user?.email ?? null,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"],
  };
}

export function requireAdmin(request: FastifyRequest): void {
  if (!hasRole(request.user.role, "ADMIN")) {
    throw forbidden("Apenas administradores podem editar diretivas personalizadas do Nginx.");
  }
}

/** JWT (Bearer) auth on every /api route, with per-route role checks. */
export async function registerAuth(app: FastifyInstance, secret: string, secureCookies: boolean): Promise<void> {
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret,
    sign: { expiresIn: ACCESS_TOKEN_TTL },
    cookie: undefined,
  });

  app.decorate("refreshCookieOptions", {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: secureCookies,
    path: "/api/auth",
  });

  app.addHook("onRequest", async (request) => {
    if (!request.url.startsWith("/api/")) return;
    const config = request.routeOptions.config;
    if (config.public) return;

    const queryToken = config.queryToken ? (request.query as Record<string, unknown>)?.access_token : undefined;
    try {
      if (typeof queryToken === "string" && queryToken.length > 0) {
        request.user = app.jwt.verify<AccessTokenPayload>(queryToken);
      } else {
        await request.jwtVerify();
      }
    } catch {
      throw unauthorized("Sessão expirada ou inválida. Faça login novamente.");
    }

    const user = await app.orla.prisma.user.findUnique({ where: { id: request.user.sub }, select: { isActive: true, role: true } });
    if (!user?.isActive) throw unauthorized("Usuário desativado.");
    request.user = { ...request.user, role: user.role };

    const required = config.role ?? (request.method === "GET" || request.method === "HEAD" ? "VIEWER" : "EDITOR");
    if (!hasRole(user.role, required)) throw forbidden();
  });
}

declare module "fastify" {
  interface FastifyInstance {
    refreshCookieOptions: { httpOnly: boolean; sameSite: "strict"; secure: boolean; path: string };
  }
}
