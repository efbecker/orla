import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { conflict, notFound } from "../lib/http-errors.js";
import { idParams, parse } from "../lib/validation.js";
import { sanitizePem, zCustomDirectives, zDomain, zHeaderValue, zPort, zUpstreamAddress, zUrl } from "../nginx/sanitize.js";
import { actorFrom, requireAdmin } from "../plugins/auth.js";
import { recordAudit } from "../services/audit.js";
import type { Tx } from "../services/config-service.js";

export const hostDetailInclude = {
  domains: { orderBy: [{ isPrimary: "desc" }, { domain: "asc" }] },
  upstreamPool: {
    include: {
      servers: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      _count: { select: { hosts: true, locations: true } },
    },
  },
  certificate: {
    select: { id: true, name: true, type: true, status: true, notAfter: true, domains: { select: { domain: true } } },
  },
  basicAuthRealm: { select: { id: true, name: true } },
  locations: {
    orderBy: [{ priority: "desc" }, { id: "asc" }],
    include: { upstreamPool: { select: { id: true, name: true, scheme: true } }, ipLists: true },
  },
  redirectRules: { orderBy: [{ priority: "desc" }, { id: "asc" }] },
  headerRules: { orderBy: [{ priority: "desc" }, { id: "asc" }] },
  rateLimitRules: { orderBy: { id: "asc" } },
  ipLists: { include: { ipList: { select: { id: true, name: true, type: true } } }, orderBy: { priority: "asc" } },
} satisfies Prisma.ProxyHostInclude;

const nullableText = (max: number) => z.string().trim().max(max).nullable().transform((value) => (value ? value : null));
const nullableId = z.number().int().positive().nullable();

const pemField = z
  .string()
  .nullable()
  .transform((value, ctx) => {
    if (!value || value.trim() === "") return null;
    try {
      return sanitizePem(value, "Certificado de CA da origem");
    } catch (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message });
      return z.NEVER;
    }
  });

const upstreamShortcut = z.object({
  scheme: z.enum(["HTTP", "HTTPS"]).default("HTTP"),
  address: zUpstreamAddress,
  port: zPort,
});

/** Every editable host field. Create requires name + domains; update is partial. */
export const hostFieldsSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: nullableText(500),
    enabled: z.boolean(),
    edgeProtectionEnabled: z.boolean(),
    maintenanceEnabled: z.boolean(),
    maintenanceTitle: nullableText(200),
    maintenanceMessage: nullableText(2000),
    maintenanceHtml: z.string().max(200_000).nullable(),
    domains: z.array(zDomain).min(1, "Informe ao menos um domínio.").max(100),
    upstreamPoolId: nullableId,
    upstream: upstreamShortcut,
    websocketEnabled: z.boolean(),
    http2Enabled: z.boolean(),
    http3Enabled: z.boolean(),
    sslMode: z.enum(["OFF", "FLEXIBLE", "FULL", "FULL_STRICT"]),
    certificateId: nullableId,
    forceHttps: z.boolean(),
    hstsEnabled: z.boolean(),
    hstsMaxAge: z.number().int().min(0).max(63_072_000),
    hstsIncludeSubdomains: z.boolean(),
    hstsPreload: z.boolean(),
    minTlsVersion: z.enum(["TLS_1_2", "TLS_1_3"]),
    originServerName: zDomain.nullable(),
    originTrustedCaPem: pemField,
    cacheEnabled: z.boolean(),
    cacheMode: z.enum(["STATIC_ONLY", "ALL"]),
    cacheDefaultTtlSeconds: z.number().int().min(1).max(31_536_000),
    cacheRespectOriginHeaders: z.boolean(),
    cacheServeStaleOnError: z.boolean(),
    gzipEnabled: z.boolean(),
    brotliEnabled: z.boolean(),
    clientMaxBodySizeMb: z.number().int().min(0).max(102_400),
    proxyConnectTimeoutSeconds: z.number().int().min(1).max(86_400),
    proxyReadTimeoutSeconds: z.number().int().min(1).max(86_400),
    proxySendTimeoutSeconds: z.number().int().min(1).max(86_400),
    proxyBufferingEnabled: z.boolean(),
    securityHeadersEnabled: z.boolean(),
    contentSecurityPolicy: zHeaderValue.nullable(),
    blockBadBotsEnabled: z.boolean(),
    authMode: z.enum(["NONE", "BASIC", "EXTERNAL"]),
    basicAuthRealmId: nullableId,
    externalAuthUrl: zUrl.nullable(),
    customDirectives: zCustomDirectives.nullable(),
    ipListIds: z.array(z.number().int().positive()).max(50),
  })
  .partial();

export type HostFields = z.infer<typeof hostFieldsSchema>;

const createSchema = hostFieldsSchema.refine((value) => value.name && value.domains, {
  message: "Nome e domínios são obrigatórios.",
});

const togglesSchema = hostFieldsSchema.pick({
  enabled: true,
  edgeProtectionEnabled: true,
  maintenanceEnabled: true,
  websocketEnabled: true,
  http2Enabled: true,
  http3Enabled: true,
  cacheEnabled: true,
  forceHttps: true,
});

const previewSchema = hostFieldsSchema.extend({ id: z.number().int().positive().optional() });

const TOGGLE_LABELS: Record<string, string> = {
  enabled: "host",
  edgeProtectionEnabled: "proteção de borda",
  maintenanceEnabled: "modo de manutenção",
  websocketEnabled: "WebSockets",
  http2Enabled: "HTTP/2",
  http3Enabled: "HTTP/3",
  cacheEnabled: "cache",
  forceHttps: "forçar HTTPS",
};

async function uniquePoolName(tx: Tx, base: string): Promise<string> {
  let candidate = base;
  for (let attempt = 2; await tx.upstreamPool.findUnique({ where: { name: candidate } }); attempt += 1) {
    candidate = `${base}-${attempt}`;
  }
  return candidate;
}

async function createOriginPool(tx: Tx, label: string, upstream: z.infer<typeof upstreamShortcut>): Promise<number> {
  const pool = await tx.upstreamPool.create({
    data: {
      name: await uniquePoolName(tx, label.replace(/^\*\./, "")),
      scheme: upstream.scheme,
      servers: { create: [{ address: upstream.address, port: upstream.port }] },
    },
  });
  return pool.id;
}

/** Creates or updates a host from validated fields; shared by save and preview. */
export async function applyHostFields(tx: Tx, id: number | null, input: HostFields): Promise<number> {
  const { domains, upstream, ipListIds, ...fields } = input;
  const data: Prisma.ProxyHostUncheckedUpdateInput = { ...fields };

  if (upstream) {
    // Editing the single origin of a host updates its private pool in place
    // instead of leaving the old pool behind.
    const current = id
      ? await tx.proxyHost.findUnique({
          where: { id },
          select: { upstreamPool: { include: { servers: true, _count: { select: { hosts: true, locations: true } } } } },
        })
      : null;
    const own = current?.upstreamPool;
    if (own && own._count.hosts === 1 && own._count.locations === 0 && own.servers.length === 1 && own.servers[0]) {
      await tx.upstreamPool.update({ where: { id: own.id }, data: { scheme: upstream.scheme } });
      await tx.upstreamServer.update({ where: { id: own.servers[0].id }, data: { address: upstream.address, port: upstream.port } });
      data.upstreamPoolId = own.id;
    } else {
      data.upstreamPoolId = await createOriginPool(tx, domains?.[0] ?? fields.name ?? "upstream", upstream);
    }
  }

  if (domains) {
    const taken = await tx.hostDomain.findMany({
      where: { domain: { in: domains }, ...(id ? { hostId: { not: id } } : {}) },
      include: { host: { select: { name: true } } },
    });
    const first = taken[0];
    if (first) throw conflict(`O domínio ${first.domain} já está em uso pelo host "${first.host.name}".`);
  }

  let hostId = id;
  if (hostId === null) {
    const created = await tx.proxyHost.create({ data: data as Prisma.ProxyHostUncheckedCreateInput });
    hostId = created.id;
  } else {
    await tx.proxyHost.update({ where: { id: hostId }, data });
  }

  if (domains) {
    const unique = [...new Set(domains)];
    await tx.hostDomain.deleteMany({ where: { hostId } });
    await tx.hostDomain.createMany({
      data: unique.map((domain, index) => ({ hostId: hostId as number, domain, isPrimary: index === 0 })),
    });
  }
  if (ipListIds) {
    await tx.hostIpList.deleteMany({ where: { hostId } });
    await tx.hostIpList.createMany({
      data: [...new Set(ipListIds)].map((ipListId, priority) => ({ hostId: hostId as number, ipListId, priority })),
    });
  }
  return hostId;
}

async function loadDetail(db: Tx | FastifyInstance["orla"]["prisma"], id: number) {
  const host = await db.proxyHost.findUnique({ where: { id }, include: hostDetailInclude });
  if (!host) throw notFound("Host não encontrado.");
  return host;
}

function primaryDomain(host: { domains: Array<{ domain: string }>; name: string }): string {
  return host.domains[0]?.domain ?? host.name;
}

export async function hostRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, config, cachePurger } = app.orla;

  app.get("/hosts", async () => {
    return prisma.proxyHost.findMany({
      orderBy: { id: "asc" },
      include: {
        domains: { orderBy: [{ isPrimary: "desc" }, { domain: "asc" }] },
        upstreamPool: { select: { id: true, name: true, scheme: true, _count: { select: { servers: true } } } },
        certificate: { select: { id: true, name: true, status: true, notAfter: true } },
        _count: { select: { locations: true, redirectRules: true, headerRules: true, rateLimitRules: true } },
      },
    });
  });

  app.get("/hosts/:id", async (request) => {
    const { id } = parse(idParams, request.params);
    return loadDetail(prisma, id);
  });

  app.get("/hosts/:id/config", async (request) => {
    const { id } = parse(idParams, request.params);
    await loadDetail(prisma, id);
    return { config: await config.preview(async () => id) };
  });

  app.post("/hosts/preview", async (request) => {
    const { id, ...input } = parse(previewSchema, request.body);
    if (input.customDirectives !== undefined) requireAdmin(request);
    if (id === undefined && (!input.name || !input.domains)) {
      return { config: "" };
    }
    return { config: await config.preview((tx) => applyHostFields(tx, id ?? null, input)) };
  });

  app.post("/hosts", async (request, reply) => {
    const input = parse(createSchema, request.body);
    if (input.customDirectives !== undefined) requireAdmin(request);
    const host = await config.change(actorFrom(request), `Criar host ${input.domains?.[0]}`, async (tx) => {
      const id = await applyHostFields(tx, null, input);
      const created = await loadDetail(tx, id);
      return {
        result: created,
        audit: { action: "CREATE", entityType: "ProxyHost", entityId: id, summary: `Host ${primaryDomain(created)} criado`, after: created },
      };
    });
    return reply.status(201).send(host);
  });

  app.patch("/hosts/:id", async (request) => {
    const { id } = parse(idParams, request.params);
    const input = parse(hostFieldsSchema, request.body);
    if (input.customDirectives !== undefined) requireAdmin(request);
    const before = await loadDetail(prisma, id);
    return config.change(actorFrom(request), `Atualizar host ${primaryDomain(before)}`, async (tx) => {
      await applyHostFields(tx, id, input);
      const after = await loadDetail(tx, id);
      return {
        result: after,
        audit: { action: "UPDATE", entityType: "ProxyHost", entityId: id, summary: `Host ${primaryDomain(after)} atualizado`, before, after },
      };
    });
  });

  app.patch("/hosts/:id/toggles", async (request) => {
    const { id } = parse(idParams, request.params);
    const input = parse(togglesSchema, request.body);
    const before = await loadDetail(prisma, id);
    const described = Object.entries(input)
      .map(([key, value]) => `${TOGGLE_LABELS[key] ?? key} ${value ? "ativado" : "desativado"}`)
      .join(", ");
    return config.change(actorFrom(request), `${primaryDomain(before)}: ${described}`, async (tx) => {
      await tx.proxyHost.update({ where: { id }, data: input });
      const after = await loadDetail(tx, id);
      return {
        result: after,
        audit: { action: "TOGGLE", entityType: "ProxyHost", entityId: id, summary: `${primaryDomain(after)}: ${described}`, before: input, after: input },
      };
    });
  });

  app.put("/hosts/:id/ip-lists", async (request) => {
    const { id } = parse(idParams, request.params);
    const { ipListIds } = parse(z.object({ ipListIds: z.array(z.number().int().positive()).max(50) }), request.body);
    const before = await loadDetail(prisma, id);
    return config.change(actorFrom(request), `Listas de IP de ${primaryDomain(before)}`, async (tx) => {
      await applyHostFields(tx, id, { ipListIds });
      const after = await loadDetail(tx, id);
      return {
        result: after,
        audit: {
          action: "UPDATE",
          entityType: "ProxyHost",
          entityId: id,
          summary: `Listas de IP de ${primaryDomain(after)} atualizadas`,
          before: before.ipLists.map((link) => link.ipListId),
          after: ipListIds,
        },
      };
    });
  });

  app.delete("/hosts/:id", async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const before = await loadDetail(prisma, id);
    await config.change(actorFrom(request), `Excluir host ${primaryDomain(before)}`, async (tx) => {
      await tx.proxyHost.delete({ where: { id } });
      return {
        result: null,
        audit: { action: "DELETE", entityType: "ProxyHost", entityId: id, summary: `Host ${primaryDomain(before)} excluído`, before },
      };
    });
    return reply.status(204).send();
  });

  app.post("/hosts/:id/cache/purge", async (request) => {
    const { id } = parse(idParams, request.params);
    const host = await loadDetail(prisma, id);
    const output = await cachePurger.purge(id);
    await prisma.proxyHost.update({ where: { id }, data: { cacheLastPurgedAt: new Date() } });
    await recordAudit(prisma, actorFrom(request), {
      action: "PURGE_CACHE",
      entityType: "ProxyHost",
      entityId: id,
      summary: `Cache de ${primaryDomain(host)} limpo`,
    });
    return { ok: true, output };
  });
}
