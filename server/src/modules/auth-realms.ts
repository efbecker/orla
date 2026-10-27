import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { conflict, notFound } from "../lib/http-errors.js";
import { hashApr1, hashHtpasswdBcrypt } from "../lib/passwords.js";
import { idParams, parse } from "../lib/validation.js";
import { sanitizeBasicAuthUsername, sanitizeQuotedText, zSanitized } from "../nginx/sanitize.js";
import { actorFrom } from "../plugins/auth.js";
import type { Tx } from "../services/config-service.js";

const realmSchema = z.object({
  name: z.string().trim().min(1).max(120),
  realm: zSanitized((value) => sanitizeQuotedText(value.trim(), "Nome do realm", 128)).default("Área restrita"),
  description: z.string().trim().max(500).nullable().default(null),
});

const userSchema = z.object({
  username: zSanitized((value) => sanitizeBasicAuthUsername(value.trim())),
  password: z.string().min(6, "A senha deve ter pelo menos 6 caracteres.").max(200),
  hashAlgorithm: z.enum(["BCRYPT", "APR1"]).default("BCRYPT"),
});

const passwordSchema = userSchema.pick({ password: true, hashAlgorithm: true });

const include = {
  users: { orderBy: { username: "asc" as const }, select: { id: true, username: true, hashAlgorithm: true, createdAt: true, updatedAt: true } },
  _count: { select: { hosts: true, locations: true } },
};

async function hashFor(algorithm: "BCRYPT" | "APR1", password: string): Promise<string> {
  return algorithm === "APR1" ? hashApr1(password) : hashHtpasswdBcrypt(password);
}

async function loadRealm(db: Tx | FastifyInstance["orla"]["prisma"], id: number) {
  const realm = await db.basicAuthRealm.findUnique({ where: { id }, include });
  if (!realm) throw notFound("Grupo de Basic Auth não encontrado.");
  return realm;
}

export async function authRealmRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, config } = app.orla;

  app.get("/auth-realms", async () => prisma.basicAuthRealm.findMany({ orderBy: { id: "asc" }, include }));

  app.get("/auth-realms/:id", async (request) => {
    const { id } = parse(idParams, request.params);
    return loadRealm(prisma, id);
  });

  app.post("/auth-realms", async (request, reply) => {
    const input = parse(realmSchema, request.body);
    const realm = await config.change(actorFrom(request), `Criar grupo Basic Auth ${input.name}`, async (tx) => {
      const created = await tx.basicAuthRealm.create({ data: input, include });
      return { result: created, audit: { action: "CREATE", entityType: "BasicAuthRealm", entityId: created.id, summary: `Grupo Basic Auth ${created.name} criado`, after: created } };
    });
    return reply.status(201).send(realm);
  });

  app.patch("/auth-realms/:id", async (request) => {
    const { id } = parse(idParams, request.params);
    const input = parse(realmSchema.partial(), request.body);
    const before = await loadRealm(prisma, id);
    return config.change(actorFrom(request), `Atualizar grupo Basic Auth ${before.name}`, async (tx) => {
      await tx.basicAuthRealm.update({ where: { id }, data: input });
      const after = await loadRealm(tx, id);
      return { result: after, audit: { action: "UPDATE", entityType: "BasicAuthRealm", entityId: id, summary: `Grupo Basic Auth ${after.name} atualizado`, before, after } };
    });
  });

  app.delete("/auth-realms/:id", async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const before = await loadRealm(prisma, id);
    if (before._count.hosts > 0 || before._count.locations > 0) {
      throw conflict(`O grupo ${before.name} está em uso por ${before._count.hosts} host(s) e ${before._count.locations} rota(s).`);
    }
    await config.change(actorFrom(request), `Excluir grupo Basic Auth ${before.name}`, async (tx) => {
      await tx.basicAuthRealm.delete({ where: { id } });
      return { result: null, audit: { action: "DELETE", entityType: "BasicAuthRealm", entityId: id, summary: `Grupo Basic Auth ${before.name} excluído`, before } };
    });
    return reply.status(204).send();
  });

  app.post("/auth-realms/:id/users", async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const input = parse(userSchema, request.body);
    const realm = await loadRealm(prisma, id);
    if (realm.users.some((user) => user.username === input.username)) throw conflict(`O usuário ${input.username} já existe neste grupo.`);
    const passwordHash = await hashFor(input.hashAlgorithm, input.password);
    const user = await config.change(actorFrom(request), `${realm.name}: adicionar usuário ${input.username}`, async (tx) => {
      const created = await tx.basicAuthUser.create({
        data: { realmId: id, username: input.username, hashAlgorithm: input.hashAlgorithm, passwordHash },
        select: { id: true, username: true, hashAlgorithm: true, createdAt: true, updatedAt: true },
      });
      return { result: created, audit: { action: "CREATE", entityType: "BasicAuthUser", entityId: created.id, summary: `${realm.name}: usuário ${created.username} criado` } };
    });
    return reply.status(201).send(user);
  });

  app.patch("/auth-realms/:id/users/:userId", async (request) => {
    const params = parse(idParams.extend({ userId: z.coerce.number().int().positive() }), request.params);
    const input = parse(passwordSchema, request.body);
    const user = await prisma.basicAuthUser.findFirst({ where: { id: params.userId, realmId: params.id }, include: { realm: true } });
    if (!user) throw notFound("Usuário não encontrado.");
    const passwordHash = await hashFor(input.hashAlgorithm, input.password);
    return config.change(actorFrom(request), `${user.realm.name}: senha de ${user.username}`, async (tx) => {
      const updated = await tx.basicAuthUser.update({
        where: { id: user.id },
        data: { passwordHash, hashAlgorithm: input.hashAlgorithm },
        select: { id: true, username: true, hashAlgorithm: true, createdAt: true, updatedAt: true },
      });
      return { result: updated, audit: { action: "UPDATE", entityType: "BasicAuthUser", entityId: user.id, summary: `${user.realm.name}: senha de ${user.username} alterada` } };
    });
  });

  app.delete("/auth-realms/:id/users/:userId", async (request, reply) => {
    const params = parse(idParams.extend({ userId: z.coerce.number().int().positive() }), request.params);
    const user = await prisma.basicAuthUser.findFirst({ where: { id: params.userId, realmId: params.id }, include: { realm: true } });
    if (!user) throw notFound("Usuário não encontrado.");
    await config.change(actorFrom(request), `${user.realm.name}: remover ${user.username}`, async (tx) => {
      await tx.basicAuthUser.delete({ where: { id: user.id } });
      return { result: null, audit: { action: "DELETE", entityType: "BasicAuthUser", entityId: user.id, summary: `${user.realm.name}: usuário ${user.username} removido` } };
    });
    return reply.status(204).send();
  });
}
