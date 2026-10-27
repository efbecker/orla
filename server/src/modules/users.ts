import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { badRequest } from "../lib/http-errors.js";
import { hashPanelPassword } from "../lib/passwords.js";
import { idParams, parse } from "../lib/validation.js";
import { actorFrom } from "../plugins/auth.js";
import { recordAudit } from "../services/audit.js";
import { passwordSchema, publicUser } from "./auth.js";

const roleSchema = z.enum(["ADMIN", "EDITOR", "VIEWER"]);

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(120),
  password: passwordSchema,
  role: roleSchema.default("VIEWER"),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    role: roleSchema,
    isActive: z.boolean(),
    password: passwordSchema,
  })
  .partial();

export async function userRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = app.orla;

  async function assertAnotherActiveAdmin(excludingId: number) {
    const admins = await prisma.user.count({ where: { role: "ADMIN", isActive: true, id: { not: excludingId } } });
    if (admins === 0) throw badRequest("O painel precisa de pelo menos um administrador ativo.");
  }

  app.get("/users", { config: { role: "ADMIN" } }, async () => {
    const users = await prisma.user.findMany({ orderBy: { id: "asc" } });
    return users.map(publicUser);
  });

  app.post("/users", { config: { role: "ADMIN" } }, async (request, reply) => {
    const input = parse(createSchema, request.body);
    const user = await prisma.user.create({
      data: { email: input.email, name: input.name, role: input.role, passwordHash: await hashPanelPassword(input.password) },
    });
    await recordAudit(prisma, actorFrom(request), {
      action: "CREATE",
      entityType: "User",
      entityId: user.id,
      summary: `Usuário ${user.email} criado (${user.role})`,
      after: publicUser(user),
    });
    return reply.status(201).send(publicUser(user));
  });

  app.patch("/users/:id", { config: { role: "ADMIN" } }, async (request) => {
    const { id } = parse(idParams, request.params);
    const input = parse(updateSchema, request.body);
    const before = await prisma.user.findUniqueOrThrow({ where: { id } });
    if ((input.role && input.role !== "ADMIN") || input.isActive === false) {
      if (before.role === "ADMIN") await assertAnotherActiveAdmin(id);
    }
    const user = await prisma.user.update({
      where: { id },
      data: {
        name: input.name,
        role: input.role,
        isActive: input.isActive,
        passwordHash: input.password ? await hashPanelPassword(input.password) : undefined,
      },
    });
    if (input.password || input.isActive === false) {
      await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await recordAudit(prisma, actorFrom(request), {
      action: "UPDATE",
      entityType: "User",
      entityId: id,
      summary: `Usuário ${user.email} atualizado`,
      before: publicUser(before),
      after: publicUser(user),
    });
    return publicUser(user);
  });

  app.delete("/users/:id", { config: { role: "ADMIN" } }, async (request, reply) => {
    const { id } = parse(idParams, request.params);
    if (id === request.user.sub) throw badRequest("Você não pode excluir o próprio usuário.");
    const before = await prisma.user.findUniqueOrThrow({ where: { id } });
    if (before.role === "ADMIN") await assertAnotherActiveAdmin(id);
    await prisma.user.delete({ where: { id } });
    await recordAudit(prisma, actorFrom(request), {
      action: "DELETE",
      entityType: "User",
      entityId: id,
      summary: `Usuário ${before.email} excluído`,
      before: publicUser(before),
    });
    return reply.status(204).send();
  });
}
