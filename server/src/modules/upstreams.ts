import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { conflict, notFound } from "../lib/http-errors.js";
import { idParams, parse } from "../lib/validation.js";
import { zPort, zUpstreamAddress } from "../nginx/sanitize.js";
import { actorFrom } from "../plugins/auth.js";
import type { Tx } from "../services/config-service.js";

const serverSchema = z.object({
  address: zUpstreamAddress,
  port: zPort,
  weight: z.number().int().min(1).max(1000).default(1),
  maxFails: z.number().int().min(0).max(100).default(3),
  failTimeoutSeconds: z.number().int().min(1).max(3600).default(10),
  isBackup: z.boolean().default(false),
  isDown: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

const poolSchema = z
  .object({
    name: z.string().trim().min(1).max(120).regex(/^[\w.\- ]+$/, "Use letras, números, espaços, ponto, hífen ou sublinhado."),
    description: z.string().trim().max(500).nullable().default(null),
    scheme: z.enum(["HTTP", "HTTPS"]).default("HTTP"),
    algorithm: z.enum(["ROUND_ROBIN", "LEAST_CONN", "IP_HASH"]).default("ROUND_ROBIN"),
    keepaliveConnections: z.number().int().min(0).max(1024).default(32),
    servers: z.array(serverSchema).min(1, "Cadastre ao menos um servidor.").max(100),
  })
  .superRefine((value, ctx) => {
    if (value.algorithm === "IP_HASH" && value.servers.some((server) => server.isBackup)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["algorithm"], message: "IP Hash não aceita servidores de backup." });
    }
    const seen = new Set<string>();
    for (const [index, server] of value.servers.entries()) {
      const key = `${server.address}:${server.port}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["servers", index], message: `Servidor ${key} repetido.` });
      }
      seen.add(key);
    }
  });

const poolInclude = {
  servers: { orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }] },
  _count: { select: { hosts: true, locations: true } },
};

async function loadPool(db: Tx | FastifyInstance["orla"]["prisma"], id: number) {
  const pool = await db.upstreamPool.findUnique({ where: { id }, include: poolInclude });
  if (!pool) throw notFound("Pool de upstream não encontrado.");
  return pool;
}

export async function upstreamRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, config } = app.orla;

  app.get("/upstream-pools", async () => prisma.upstreamPool.findMany({ orderBy: { id: "asc" }, include: poolInclude }));

  app.get("/upstream-pools/:id", async (request) => {
    const { id } = parse(idParams, request.params);
    return loadPool(prisma, id);
  });

  app.post("/upstream-pools", async (request, reply) => {
    const { servers, ...input } = parse(poolSchema, request.body);
    const pool = await config.change(actorFrom(request), `Criar pool ${input.name}`, async (tx) => {
      const created = await tx.upstreamPool.create({ data: { ...input, servers: { create: servers } }, include: poolInclude });
      return {
        result: created,
        audit: { action: "CREATE", entityType: "UpstreamPool", entityId: created.id, summary: `Pool ${created.name} criado`, after: created },
      };
    });
    return reply.status(201).send(pool);
  });

  /** Replaces the pool definition, including the full server list. */
  app.put("/upstream-pools/:id", async (request) => {
    const { id } = parse(idParams, request.params);
    const { servers, ...input } = parse(poolSchema, request.body);
    const before = await loadPool(prisma, id);
    return config.change(actorFrom(request), `Atualizar pool ${input.name}`, async (tx) => {
      await tx.upstreamServer.deleteMany({ where: { poolId: id } });
      await tx.upstreamPool.update({ where: { id }, data: { ...input, servers: { create: servers } } });
      const after = await loadPool(tx, id);
      return {
        result: after,
        audit: { action: "UPDATE", entityType: "UpstreamPool", entityId: id, summary: `Pool ${after.name} atualizado`, before, after },
      };
    });
  });

  app.patch("/upstream-pools/:id/servers/:serverId", async (request) => {
    const params = parse(idParams.extend({ serverId: z.coerce.number().int().positive() }), request.params);
    const input = parse(z.object({ isDown: z.boolean().optional(), isBackup: z.boolean().optional(), weight: z.number().int().min(1).max(1000).optional() }), request.body);
    const server = await prisma.upstreamServer.findFirst({ where: { id: params.serverId, poolId: params.id } });
    if (!server) throw notFound("Servidor não encontrado.");
    const pool = await loadPool(prisma, params.id);
    if (input.isBackup && pool.algorithm === "IP_HASH") throw conflict("IP Hash não aceita servidores de backup.");
    const label = `${server.address}:${server.port}`;
    return config.change(actorFrom(request), `Pool ${pool.name}: servidor ${label}`, async (tx) => {
      const updated = await tx.upstreamServer.update({ where: { id: server.id }, data: input });
      return {
        result: updated,
        audit: {
          action: "TOGGLE",
          entityType: "UpstreamServer",
          entityId: server.id,
          summary: `Pool ${pool.name}: servidor ${label} ${input.isDown === true ? "desativado" : input.isDown === false ? "reativado" : "atualizado"}`,
          before: server,
          after: updated,
        },
      };
    });
  });

  app.delete("/upstream-pools/:id", async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const before = await loadPool(prisma, id);
    if (before._count.hosts > 0 || before._count.locations > 0) {
      throw conflict(`O pool ${before.name} está em uso por ${before._count.hosts} host(s) e ${before._count.locations} rota(s).`);
    }
    await config.change(actorFrom(request), `Excluir pool ${before.name}`, async (tx) => {
      await tx.upstreamPool.delete({ where: { id } });
      return { result: null, audit: { action: "DELETE", entityType: "UpstreamPool", entityId: id, summary: `Pool ${before.name} excluído`, before } };
    });
    return reply.status(204).send();
  });
}
