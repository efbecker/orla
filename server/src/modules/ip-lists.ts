import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { conflict, notFound } from "../lib/http-errors.js";
import { idParams, parse } from "../lib/validation.js";
import { zIpOrCidr } from "../nginx/sanitize.js";
import { actorFrom } from "../plugins/auth.js";
import type { Tx } from "../services/config-service.js";

const entrySchema = z.object({ cidr: zIpOrCidr, comment: z.string().trim().max(200).nullable().default(null) });

const listSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().default(null),
  type: z.enum(["ALLOWLIST", "BLOCKLIST"]),
  entries: z
    .array(entrySchema)
    .max(10_000)
    .default([])
    .refine((entries) => new Set(entries.map((entry) => entry.cidr)).size === entries.length, "Há IPs repetidos na lista."),
});

const include = {
  entries: { orderBy: { id: "asc" as const } },
  _count: { select: { hosts: true, locations: true } },
};

async function loadList(db: Tx | FastifyInstance["orla"]["prisma"], id: number) {
  const list = await db.ipList.findUnique({ where: { id }, include });
  if (!list) throw notFound("Lista de IPs não encontrada.");
  return list;
}

export async function ipListRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, config } = app.orla;

  app.get("/ip-lists", async () => prisma.ipList.findMany({ orderBy: { id: "asc" }, include }));

  app.get("/ip-lists/:id", async (request) => {
    const { id } = parse(idParams, request.params);
    return loadList(prisma, id);
  });

  app.post("/ip-lists", async (request, reply) => {
    const { entries, ...input } = parse(listSchema, request.body);
    const list = await config.change(actorFrom(request), `Criar lista de IPs ${input.name}`, async (tx) => {
      const created = await tx.ipList.create({ data: { ...input, entries: { create: entries } }, include });
      return {
        result: created,
        audit: { action: "CREATE", entityType: "IpList", entityId: created.id, summary: `Lista de IPs ${created.name} criada`, after: created },
      };
    });
    return reply.status(201).send(list);
  });

  /** Replaces the list, including all entries. */
  app.put("/ip-lists/:id", async (request) => {
    const { id } = parse(idParams, request.params);
    const { entries, ...input } = parse(listSchema, request.body);
    const before = await loadList(prisma, id);
    return config.change(actorFrom(request), `Atualizar lista de IPs ${input.name}`, async (tx) => {
      await tx.ipListEntry.deleteMany({ where: { ipListId: id } });
      await tx.ipList.update({ where: { id }, data: { ...input, entries: { create: entries } } });
      const after = await loadList(tx, id);
      return {
        result: after,
        audit: { action: "UPDATE", entityType: "IpList", entityId: id, summary: `Lista de IPs ${after.name} atualizada`, before, after },
      };
    });
  });

  app.post("/ip-lists/:id/entries", async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const entry = parse(entrySchema, request.body);
    const list = await loadList(prisma, id);
    if (list.entries.some((existing) => existing.cidr === entry.cidr)) throw conflict(`${entry.cidr} já está na lista.`);
    const created = await config.change(actorFrom(request), `${list.name}: adicionar ${entry.cidr}`, async (tx) => {
      const row = await tx.ipListEntry.create({ data: { ...entry, ipListId: id } });
      return { result: row, audit: { action: "CREATE", entityType: "IpListEntry", entityId: row.id, summary: `${list.name}: ${entry.cidr} adicionado`, after: row } };
    });
    return reply.status(201).send(created);
  });

  app.delete("/ip-lists/:id/entries/:entryId", async (request, reply) => {
    const params = parse(idParams.extend({ entryId: z.coerce.number().int().positive() }), request.params);
    const entry = await prisma.ipListEntry.findFirst({ where: { id: params.entryId, ipListId: params.id }, include: { ipList: true } });
    if (!entry) throw notFound("Entrada não encontrada.");
    await config.change(actorFrom(request), `${entry.ipList.name}: remover ${entry.cidr}`, async (tx) => {
      await tx.ipListEntry.delete({ where: { id: entry.id } });
      return { result: null, audit: { action: "DELETE", entityType: "IpListEntry", entityId: entry.id, summary: `${entry.ipList.name}: ${entry.cidr} removido`, before: entry } };
    });
    return reply.status(204).send();
  });

  app.delete("/ip-lists/:id", async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const before = await loadList(prisma, id);
    await config.change(actorFrom(request), `Excluir lista de IPs ${before.name}`, async (tx) => {
      await tx.ipList.delete({ where: { id } });
      return { result: null, audit: { action: "DELETE", entityType: "IpList", entityId: id, summary: `Lista de IPs ${before.name} excluída`, before } };
    });
    return reply.status(204).send();
  });
}
