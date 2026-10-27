import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { randomToken, sha256Hex } from "../lib/crypto.js";
import { badRequest, unauthorized } from "../lib/http-errors.js";
import { hashPanelPassword, verifyPanelPassword } from "../lib/passwords.js";
import { parse } from "../lib/validation.js";
import { actorFrom, REFRESH_COOKIE } from "../plugins/auth.js";
import { recordAudit } from "../services/audit.js";

const REFRESH_TTL_MS = 30 * 86_400_000;

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe a senha."),
});

export const passwordSchema = z
  .string()
  .min(10, "A senha deve ter pelo menos 10 caracteres.")
  .max(200, "A senha deve ter no máximo 200 caracteres.");

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export function publicUser(user: { id: number; email: string; name: string; role: string; isActive: boolean; lastLoginAt: Date | null; createdAt: Date }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = app.orla;

  await app.register(rateLimit, { global: false });

  async function issueSession(
    reply: FastifyReply,
    user: { id: number; email: string; role: "ADMIN" | "EDITOR" | "VIEWER" },
    meta: { ip: string; userAgent?: string },
  ) {
    const refreshToken = randomToken();
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: sha256Hex(refreshToken),
        userAgent: meta.userAgent?.slice(0, 512) ?? null,
        ipAddress: meta.ip,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    void reply.setCookie(REFRESH_COOKIE, refreshToken, { ...app.refreshCookieOptions, maxAge: REFRESH_TTL_MS / 1000 });
    return app.jwt.sign({ sub: user.id, email: user.email, role: user.role });
  }

  app.post(
    "/auth/login",
    { config: { public: true, rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = parse(loginSchema, request.body);
      const user = await prisma.user.findUnique({ where: { email: input.email } });
      const valid = user?.isActive ? await verifyPanelPassword(input.password, user.passwordHash) : false;
      if (!user || !valid) {
        await recordAudit(prisma, { userId: user?.id ?? null, email: input.email, ipAddress: request.ip, userAgent: request.headers["user-agent"] }, {
          action: "LOGIN_FAILED",
          entityType: "User",
          entityId: user?.id,
          summary: `Falha de login para ${input.email}`,
        });
        throw unauthorized("E-mail ou senha incorretos.");
      }
      const updated = await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      const accessToken = await issueSession(reply, updated, { ip: request.ip, userAgent: request.headers["user-agent"] });
      await recordAudit(prisma, { userId: user.id, email: user.email, ipAddress: request.ip, userAgent: request.headers["user-agent"] }, {
        action: "LOGIN",
        entityType: "User",
        entityId: user.id,
        summary: `Login de ${user.email}`,
      });
      return { accessToken, user: publicUser(updated) };
    },
  );

  app.post(
    "/auth/refresh",
    { config: { public: true, rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const token = request.cookies[REFRESH_COOKIE];
      if (!token) throw unauthorized("Sessão expirada. Faça login novamente.");
      const session = await prisma.session.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { user: true } });
      if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.isActive) {
        void reply.clearCookie(REFRESH_COOKIE, app.refreshCookieOptions);
        throw unauthorized("Sessão expirada. Faça login novamente.");
      }
      // Rotation: every refresh token is single-use.
      await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      const accessToken = await issueSession(reply, session.user, { ip: request.ip, userAgent: request.headers["user-agent"] });
      return { accessToken, user: publicUser(session.user) };
    },
  );

  app.post("/auth/logout", { config: { public: true } }, async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    if (token) {
      const session = await prisma.session.findUnique({ where: { tokenHash: sha256Hex(token) } });
      if (session && !session.revokedAt) {
        await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
        const user = await prisma.user.findUnique({ where: { id: session.userId } });
        await recordAudit(prisma, { userId: session.userId, email: user?.email ?? null, ipAddress: request.ip }, {
          action: "LOGOUT",
          entityType: "User",
          entityId: session.userId,
          summary: `Logout de ${user?.email ?? session.userId}`,
        });
      }
    }
    void reply.clearCookie(REFRESH_COOKIE, app.refreshCookieOptions);
    return { ok: true };
  });

  app.get("/auth/me", async (request) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user.sub } });
    return publicUser(user);
  });

  app.post("/auth/change-password", { config: { role: "VIEWER" } }, async (request) => {
    const input = parse(changePasswordSchema, request.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user.sub } });
    if (!(await verifyPanelPassword(input.currentPassword, user.passwordHash))) {
      throw badRequest("A senha atual está incorreta.");
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPanelPassword(input.newPassword) } }),
      prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await recordAudit(prisma, actorFrom(request), {
      action: "UPDATE",
      entityType: "User",
      entityId: user.id,
      summary: `${user.email} alterou a própria senha`,
    });
    return { ok: true };
  });
}
