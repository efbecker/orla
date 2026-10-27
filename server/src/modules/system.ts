import { AuditAction } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { paginate, paginationQuery, parse } from "../lib/validation.js";
import { readCapabilities } from "../nginx/capabilities.js";
import { actorFrom } from "../plugins/auth.js";
import { recordAudit } from "../services/audit.js";
import { settingsUpdateSchema } from "../services/settings.js";

const auditQuery = paginationQuery.extend({
  entityType: z.string().max(64).optional(),
  entityId: z.string().max(64).optional(),
  userId: z.coerce.number().int().positive().optional(),
  action: z.nativeEnum(AuditAction).optional(),
});

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, config, settings, env, cachePurger } = app.orla;

  app.get("/health", { config: { public: true } }, async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ok" };
    } catch {
      return reply.status(503).send({ status: "error", message: "Banco de dados indisponível." });
    }
  });

  app.get("/system/info", async () => {
    const [capabilities, lastDeployment, counts] = await Promise.all([
      readCapabilities(env.ORLA_NGINX_RUNTIME_DIR),
      prisma.deployment.findFirst({ orderBy: { id: "desc" } }),
      Promise.all([prisma.proxyHost.count(), prisma.certificate.count(), prisma.upstreamPool.count()]),
    ]);
    return {
      version: process.env.npm_package_version ?? "0.1.0",
      node: process.version,
      capabilities,
      counts: { hosts: counts[0], certificates: counts[1], upstreamPools: counts[2] },
      lastDeployment,
    };
  });

  /** Recompiles every file from the database and reloads Nginx. */
  app.post("/system/apply", async (request) => {
    const actor = actorFrom(request);
    const result = await config.sync("USER", actor.userId, "Reaplicar configuração completa");
    await recordAudit(prisma, actor, { action: "APPLY", entityType: "System", summary: "Configuração completa reaplicada" });
    return result;
  });

  /** Runs `nginx -t` on a fresh compilation without applying it. */
  app.post("/system/validate", async () => config.validate());

  app.post("/system/cache/purge", { config: { role: "ADMIN" } }, async (request) => {
    const output = await cachePurger.purge("all");
    await prisma.proxyHost.updateMany({ where: { cacheEnabled: true }, data: { cacheLastPurgedAt: new Date() } });
    await recordAudit(prisma, actorFrom(request), { action: "PURGE_CACHE", entityType: "System", summary: "Cache de todos os hosts limpo" });
    return { ok: true, output };
  });

  app.get("/deployments", async (request) => {
    const query = parse(paginationQuery, request.query);
    const [items, total] = await Promise.all([
      prisma.deployment.findMany({
        orderBy: { id: "desc" },
        ...paginate(query),
        include: { triggeredBy: { select: { id: true, email: true, name: true } } },
      }),
      prisma.deployment.count(),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  });

  app.get("/audit-logs", async (request) => {
    const query = parse(auditQuery, request.query);
    const where = {
      entityType: query.entityType,
      entityId: query.entityId,
      userId: query.userId,
      action: query.action,
    };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { id: "desc" }, ...paginate(query) }),
      prisma.auditLog.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  });

  app.get("/settings", async () => settings.toPublic(await settings.get()));

  app.put("/settings", { config: { role: "ADMIN" } }, async (request) => {
    const input = parse(settingsUpdateSchema, request.body);
    const { before, after } = await settings.update(input);
    await recordAudit(prisma, actorFrom(request), {
      action: "UPDATE",
      entityType: "Settings",
      summary: "Configurações do painel atualizadas",
      before: settings.toPublic(before),
      after: settings.toPublic(after),
    });
    return settings.toPublic(after);
  });
}
