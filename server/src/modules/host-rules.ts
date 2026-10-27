import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { badRequest, notFound } from "../lib/http-errors.js";
import { parse } from "../lib/validation.js";
import { buildRedirect } from "../nginx/templates/host.js";
import {
  sanitizeHeaderName,
  sanitizePath,
  sanitizeRegex,
  sanitizeWildcardPath,
  zCustomDirectives,
  zHeaderValue,
  zUrl,
} from "../nginx/sanitize.js";
import { ConfigValidationError } from "../nginx/errors.js";
import { actorFrom, requireAdmin } from "../plugins/auth.js";
import type { Tx } from "../services/config-service.js";

/*
 * Rules that belong to one host: custom locations, redirects, transform
 * (header) rules and rate limits. Every write goes through the transactional
 * config pipeline.
 */

const hostParams = z.object({ id: z.coerce.number().int().positive() });
const ruleParams = hostParams.extend({ ruleId: z.coerce.number().int().positive() });

const matchType = z.enum(["EXACT", "PREFIX", "WILDCARD", "REGEX", "REGEX_CASE_INSENSITIVE"]);

function validatePath(type: z.infer<typeof matchType>, value: string, field: string): string {
  switch (type) {
    case "EXACT":
    case "PREFIX":
      return sanitizePath(value, field);
    case "WILDCARD":
      return sanitizeWildcardPath(value, field);
    default:
      return sanitizeRegex(value, field);
  }
}

function wrapValidation<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      throw badRequest(error.message, [{ path: error.field ?? "", message: error.message }]);
    }
    throw error;
  }
}

const locationSchema = z
  .object({
    path: z.string().trim().min(1).max(512),
    matchType: matchType.default("PREFIX"),
    upstreamPoolId: z.number().int().positive().nullable().default(null),
    rewritePath: z.string().trim().max(512).nullable().default(null),
    priority: z.number().int().min(-1000).max(1000).default(0),
    enabled: z.boolean().default(true),
    websocketEnabled: z.boolean().nullable().default(null),
    cacheEnabled: z.boolean().nullable().default(null),
    clientMaxBodySizeMb: z.number().int().min(0).max(102_400).nullable().default(null),
    authMode: z.enum(["NONE", "BASIC", "EXTERNAL"]).nullable().default(null),
    basicAuthRealmId: z.number().int().positive().nullable().default(null),
    externalAuthUrl: zUrl.nullable().default(null),
    customDirectives: zCustomDirectives.nullable().default(null),
    ipListIds: z.array(z.number().int().positive()).max(50).default([]),
  })
  .transform((value) =>
    wrapValidation(() => ({
      ...value,
      path: validatePath(value.matchType, value.path, "path"),
      rewritePath: value.rewritePath ? sanitizePath(value.rewritePath, "rewritePath") : null,
    })),
  );

const redirectSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean().default(true),
    matchType: matchType.default("PREFIX"),
    sourcePath: z.string().trim().min(1).max(512).default("/"),
    targetUrl: z.string().trim().min(1).max(2048),
    statusCode: z.enum(["MOVED_PERMANENTLY_301", "FOUND_302", "TEMPORARY_REDIRECT_307", "PERMANENT_REDIRECT_308"]).default("MOVED_PERMANENTLY_301"),
    preservePath: z.boolean().default(true),
    preserveQuery: z.boolean().default(true),
    priority: z.number().int().min(-1000).max(1000).default(0),
  })
  .transform((value) => wrapValidation(() => (buildRedirect(value), value)));

const headerRuleSchema = z
  .object({
    locationId: z.number().int().positive().nullable().default(null),
    phase: z.enum(["REQUEST", "RESPONSE"]),
    operation: z.enum(["SET", "ADD", "REMOVE"]),
    headerName: z.string().trim().min(1).max(128),
    headerValue: zHeaderValue.nullable().default(null),
    always: z.boolean().default(false),
    priority: z.number().int().min(-1000).max(1000).default(0),
    enabled: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.operation !== "REMOVE" && !value.headerValue) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["headerValue"], message: "Informe o valor do cabeçalho." });
    }
  })
  .transform((value) =>
    wrapValidation(() => ({
      ...value,
      headerName: sanitizeHeaderName(value.headerName, value.phase),
      headerValue: value.operation === "REMOVE" ? null : value.headerValue,
    })),
  );

const rateLimitSchema = z.object({
  locationId: z.number().int().positive().nullable().default(null),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  key: z.enum(["IP", "IP_AND_PATH"]).default("IP"),
  requests: z.number().int().min(1).max(100_000),
  period: z.enum(["SECOND", "MINUTE"]).default("SECOND"),
  burst: z.number().int().min(0).max(100_000).default(0),
  nodelay: z.boolean().default(true),
  zoneSizeMb: z.number().int().min(1).max(512).default(10),
});

async function hostLabel(tx: Tx | FastifyInstance["orla"]["prisma"], hostId: number): Promise<string> {
  const host = await tx.proxyHost.findUnique({
    where: { id: hostId },
    include: { domains: { orderBy: [{ isPrimary: "desc" }, { domain: "asc" }], take: 1 } },
  });
  if (!host) throw notFound("Host não encontrado.");
  return host.domains[0]?.domain ?? host.name;
}

async function assertLocationOfHost(tx: Tx, hostId: number, locationId: number | null): Promise<void> {
  if (locationId === null) return;
  const location = await tx.location.findFirst({ where: { id: locationId, hostId } });
  if (!location) throw badRequest("A rota informada não pertence a este host.");
}

export async function hostRuleRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, config } = app.orla;

  // -------------------------------------------------------------------------
  // Locations
  // -------------------------------------------------------------------------

  app.get("/hosts/:id/locations", async (request) => {
    const { id } = parse(hostParams, request.params);
    return prisma.location.findMany({
      where: { hostId: id },
      orderBy: [{ priority: "desc" }, { id: "asc" }],
      include: { upstreamPool: { select: { id: true, name: true } }, ipLists: true },
    });
  });

  const saveLocation = async (
    request: FastifyRequest,
    hostId: number,
    locationId: number | null,
    partial: boolean,
  ) => {
    const raw = (request.body ?? {}) as Record<string, unknown>;
    if (raw.customDirectives !== undefined) requireAdmin(request);
    const label = await hostLabel(prisma, hostId);
    const existing = locationId ? await prisma.location.findFirst({ where: { id: locationId, hostId }, include: { ipLists: true } }) : null;
    if (locationId && !existing) throw notFound("Rota não encontrada.");
    const merged = partial && existing
      ? { ...existing, ipListIds: existing.ipLists.map((link) => link.ipListId), ...raw }
      : raw;
    const { ipListIds, ...input } = parse(locationSchema, merged);

    return config.change(actorFrom(request), `${label}: rota ${input.path}`, async (tx) => {
      const location = existing
        ? await tx.location.update({ where: { id: existing.id }, data: input })
        : await tx.location.create({ data: { ...input, hostId } });
      await tx.locationIpList.deleteMany({ where: { locationId: location.id } });
      await tx.locationIpList.createMany({
        data: [...new Set(ipListIds)].map((ipListId, priority) => ({ locationId: location.id, ipListId, priority })),
      });
      return {
        result: location,
        audit: {
          action: existing ? "UPDATE" : "CREATE",
          entityType: "Location",
          entityId: location.id,
          summary: `${label}: rota ${location.path} ${existing ? "atualizada" : "criada"}`,
          before: existing,
          after: location,
        },
      };
    });
  };

  app.post("/hosts/:id/locations", async (request, reply) => {
    const { id } = parse(hostParams, request.params);
    return reply.status(201).send(await saveLocation(request, id, null, false));
  });

  app.patch("/hosts/:id/locations/:ruleId", async (request) => {
    const { id, ruleId } = parse(ruleParams, request.params);
    return saveLocation(request, id, ruleId, true);
  });

  app.delete("/hosts/:id/locations/:ruleId", async (request, reply) => {
    const { id, ruleId } = parse(ruleParams, request.params);
    const existing = await prisma.location.findFirst({ where: { id: ruleId, hostId: id } });
    if (!existing) throw notFound("Rota não encontrada.");
    const label = await hostLabel(prisma, id);
    await config.change(actorFrom(request), `${label}: remover rota ${existing.path}`, async (tx) => {
      await tx.location.delete({ where: { id: ruleId } });
      return {
        result: null,
        audit: { action: "DELETE", entityType: "Location", entityId: ruleId, summary: `${label}: rota ${existing.path} removida`, before: existing },
      };
    });
    return reply.status(204).send();
  });

  // -------------------------------------------------------------------------
  // Redirects, header rules and rate limits share the same CRUD shape
  // -------------------------------------------------------------------------

  type RuleModel = "redirectRule" | "headerRule" | "rateLimitRule";

  interface RuleResource {
    path: string;
    model: RuleModel;
    entityType: string;
    label: string;
    schema: z.ZodTypeAny;
    describe: (rule: Record<string, unknown>) => string;
    validate?: (tx: Tx, hostId: number, data: Record<string, unknown>) => Promise<void>;
  }

  const resources: RuleResource[] = [
    {
      path: "redirects",
      model: "redirectRule",
      entityType: "RedirectRule",
      label: "redirecionamento",
      schema: redirectSchema,
      describe: (rule) => `${rule.sourcePath} → ${rule.targetUrl}`,
    },
    {
      path: "header-rules",
      model: "headerRule",
      entityType: "HeaderRule",
      label: "regra de cabeçalho",
      schema: headerRuleSchema,
      describe: (rule) => `${rule.operation} ${rule.headerName}`,
      validate: (tx, hostId, data) => assertLocationOfHost(tx, hostId, (data.locationId as number | null) ?? null),
    },
    {
      path: "rate-limits",
      model: "rateLimitRule",
      entityType: "RateLimitRule",
      label: "limite de requisições",
      schema: rateLimitSchema,
      describe: (rule) => `${rule.name} (${rule.requests}/${rule.period === "MINUTE" ? "min" : "s"})`,
      validate: (tx, hostId, data) => assertLocationOfHost(tx, hostId, (data.locationId as number | null) ?? null),
    },
  ];

  for (const resource of resources) {
    // Prisma delegates share this structural interface for the calls below.
    const delegate = (db: Tx | typeof prisma) =>
      db[resource.model] as unknown as {
        findMany(args: object): Promise<Array<Record<string, unknown>>>;
        findFirst(args: object): Promise<Record<string, unknown> | null>;
        create(args: object): Promise<Record<string, unknown> & { id: number }>;
        update(args: object): Promise<Record<string, unknown> & { id: number }>;
        delete(args: object): Promise<unknown>;
      };

    app.get(`/hosts/:id/${resource.path}`, async (request) => {
      const { id } = parse(hostParams, request.params);
      return delegate(prisma).findMany({ where: { hostId: id }, orderBy: [{ id: "asc" }] });
    });

    const save = async (request: FastifyRequest, hostId: number, ruleId: number | null) => {
      const label = await hostLabel(prisma, hostId);
      const existing = ruleId ? await delegate(prisma).findFirst({ where: { id: ruleId, hostId } }) : null;
      if (ruleId && !existing) throw notFound("Regra não encontrada.");
      const { id: _id, hostId: _hostId, createdAt: _c, updatedAt: _u, ...current } = existing ?? {};
      const data = parse(resource.schema, existing ? { ...current, ...(request.body as object) } : request.body) as Record<string, unknown>;

      return config.change(actorFrom(request), `${label}: ${resource.label} ${resource.describe(data)}`, async (tx) => {
        await resource.validate?.(tx, hostId, data);
        const rule = existing
          ? await delegate(tx).update({ where: { id: ruleId }, data })
          : await delegate(tx).create({ data: { ...data, hostId } });
        return {
          result: rule,
          audit: {
            action: existing ? "UPDATE" : "CREATE",
            entityType: resource.entityType,
            entityId: rule.id,
            summary: `${label}: ${resource.label} ${resource.describe(rule)} ${existing ? "atualizado" : "criado"}`,
            before: existing,
            after: rule,
          },
        };
      });
    };

    app.post(`/hosts/:id/${resource.path}`, async (request, reply) => {
      const { id } = parse(hostParams, request.params);
      return reply.status(201).send(await save(request, id, null));
    });

    app.patch(`/hosts/:id/${resource.path}/:ruleId`, async (request) => {
      const { id, ruleId } = parse(ruleParams, request.params);
      return save(request, id, ruleId);
    });

    app.delete(`/hosts/:id/${resource.path}/:ruleId`, async (request, reply) => {
      const { id, ruleId } = parse(ruleParams, request.params);
      const existing = await delegate(prisma).findFirst({ where: { id: ruleId, hostId: id } });
      if (!existing) throw notFound("Regra não encontrada.");
      const label = await hostLabel(prisma, id);
      await config.change(actorFrom(request), `${label}: remover ${resource.label}`, async (tx) => {
        await delegate(tx).delete({ where: { id: ruleId } });
        return {
          result: null,
          audit: {
            action: "DELETE",
            entityType: resource.entityType,
            entityId: ruleId,
            summary: `${label}: ${resource.label} ${resource.describe(existing)} removido`,
            before: existing,
          },
        };
      });
      return reply.status(204).send();
    });
  }
}
