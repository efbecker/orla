import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { conflict, notFound } from "../lib/http-errors.js";
import { idParams, parse } from "../lib/validation.js";
import { actorFrom } from "../plugins/auth.js";
import { recordAudit } from "../services/audit.js";
import { dnsCredentialsSchema } from "../services/dns-providers.js";

const providerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(["CLOUDFLARE", "DIGITALOCEAN", "HETZNER"]),
  credentials: dnsCredentialsSchema,
  propagationSeconds: z.number().int().min(10).max(600).default(60),
});

const updateSchema = providerSchema.partial();

const PUBLIC_FIELDS = {
  id: true,
  name: true,
  type: true,
  propagationSeconds: true,
  credentialsEncrypted: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { certificates: true } },
} as const;

type Row = { credentialsEncrypted: string | null } & Record<string, unknown>;

/** Credentials are write-only: responses only say whether they are set. */
function toPublic(row: Row) {
  const { credentialsEncrypted, ...rest } = row;
  return { ...rest, credentialsConfigured: credentialsEncrypted !== null };
}

export async function dnsProviderRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, secrets } = app.orla;

  app.get("/dns-providers", async () => {
    const rows = await prisma.dnsProvider.findMany({ orderBy: { id: "asc" }, select: PUBLIC_FIELDS });
    return rows.map(toPublic);
  });

  app.post("/dns-providers", async (request, reply) => {
    const { credentials, ...input } = parse(providerSchema, request.body);
    const row = await prisma.dnsProvider.create({
      data: { ...input, credentialsEncrypted: secrets.encrypt(JSON.stringify(credentials)) },
      select: PUBLIC_FIELDS,
    });
    await recordAudit(prisma, actorFrom(request), {
      action: "CREATE",
      entityType: "DnsProvider",
      entityId: row.id,
      summary: `Provedor de DNS ${row.name} (${row.type}) criado`,
    });
    return reply.status(201).send(toPublic(row));
  });

  app.patch("/dns-providers/:id", async (request) => {
    const { id } = parse(idParams, request.params);
    const { credentials, ...input } = parse(updateSchema, request.body);
    const exists = await prisma.dnsProvider.findUnique({ where: { id } });
    if (!exists) throw notFound("Provedor de DNS não encontrado.");
    const row = await prisma.dnsProvider.update({
      where: { id },
      data: { ...input, ...(credentials ? { credentialsEncrypted: secrets.encrypt(JSON.stringify(credentials)) } : {}) },
      select: PUBLIC_FIELDS,
    });
    await recordAudit(prisma, actorFrom(request), {
      action: "UPDATE",
      entityType: "DnsProvider",
      entityId: id,
      summary: `Provedor de DNS ${row.name} atualizado${credentials ? " (credenciais trocadas)" : ""}`,
    });
    return toPublic(row);
  });

  app.delete("/dns-providers/:id", async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const row = await prisma.dnsProvider.findUnique({ where: { id }, select: PUBLIC_FIELDS });
    if (!row) throw notFound("Provedor de DNS não encontrado.");
    if (row._count.certificates > 0) throw conflict(`O provedor ${row.name} é usado por ${row._count.certificates} certificado(s).`);
    await prisma.dnsProvider.delete({ where: { id } });
    await recordAudit(prisma, actorFrom(request), {
      action: "DELETE",
      entityType: "DnsProvider",
      entityId: id,
      summary: `Provedor de DNS ${row.name} excluído`,
    });
    return reply.status(204).send();
  });
}
