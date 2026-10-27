import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { badRequest, conflict, notFound } from "../lib/http-errors.js";
import { idParams, parse } from "../lib/validation.js";
import { sanitizeDomain, zDomain } from "../nginx/sanitize.js";
import { actorFrom } from "../plugins/auth.js";
import { recordAudit } from "../services/audit.js";
import { assertKeyMatches, parseCertificate } from "../services/certificate-info.js";

const PUBLIC_FIELDS = {
  id: true,
  name: true,
  type: true,
  status: true,
  autoRenew: true,
  challengeType: true,
  dnsProviderId: true,
  acmeAccountId: true,
  issuer: true,
  serialNumber: true,
  fingerprint: true,
  notBefore: true,
  notAfter: true,
  lastRenewAttemptAt: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
  domains: { select: { domain: true }, orderBy: { id: "asc" as const } },
  dnsProvider: { select: { id: true, name: true, type: true } },
  acmeAccount: { select: { provider: true, email: true } },
  hosts: { select: { id: true, name: true } },
};

const acmeSchema = z
  .object({
    name: z.string().trim().max(120).optional(),
    domains: z.array(zDomain).min(1).max(100),
    challengeType: z.enum(["HTTP_01", "DNS_01"]).default("HTTP_01"),
    dnsProviderId: z.number().int().positive().nullable().default(null),
    provider: z.enum(["LETSENCRYPT", "LETSENCRYPT_STAGING", "ZEROSSL"]).optional(),
    autoRenew: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.challengeType === "HTTP_01" && value.domains.some((domain) => domain.startsWith("*."))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["challengeType"], message: "Certificados curinga exigem o desafio DNS-01." });
    }
    if (value.challengeType === "DNS_01" && !value.dnsProviderId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dnsProviderId"], message: "Escolha um provedor de DNS para o desafio DNS-01." });
    }
  });

const customSchema = z.object({
  name: z.string().trim().min(1).max(120),
  certificatePem: z.string().min(1).max(200_000),
  privateKeyPem: z.string().min(1).max(50_000),
  chainPem: z.string().max(200_000).nullable().default(null),
});

const updateSchema = z.object({ name: z.string().trim().min(1).max(120), autoRenew: z.boolean() }).partial();

export async function certificateRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, acme, config, secrets, settings } = app.orla;

  const load = async (id: number) => {
    const certificate = await prisma.certificate.findUnique({ where: { id }, select: PUBLIC_FIELDS });
    if (!certificate) throw notFound("Certificado não encontrado.");
    return { ...certificate, issuing: acme.isRunning(id) };
  };

  app.get("/certificates", async () => {
    const certificates = await prisma.certificate.findMany({ orderBy: { id: "asc" }, select: PUBLIC_FIELDS });
    return certificates.map((certificate) => ({ ...certificate, issuing: acme.isRunning(certificate.id) }));
  });

  app.get("/certificates/:id", async (request) => {
    const { id } = parse(idParams, request.params);
    return load(id);
  });

  /** Requests a certificate from Let's Encrypt / ZeroSSL; issuance continues in background. */
  app.post("/certificates/acme", async (request, reply) => {
    const input = parse(acmeSchema, request.body);
    const current = await settings.get();
    if (!current.acmeEmail) throw badRequest("Configure o e-mail ACME em Configurações antes de emitir certificados.");
    if (input.dnsProviderId) {
      const provider = await prisma.dnsProvider.findUnique({ where: { id: input.dnsProviderId } });
      if (!provider) throw badRequest("Provedor de DNS não encontrado.");
    }
    const provider = input.provider ?? current.acmeProvider;
    const account = await acme.ensureAccount(provider, current.acmeEmail);
    const domains = [...new Set(input.domains)];
    const certificate = await prisma.certificate.create({
      data: {
        name: input.name || domains[0] || "Certificado",
        type: "ACME",
        status: "PENDING",
        autoRenew: input.autoRenew,
        challengeType: input.challengeType,
        dnsProviderId: input.dnsProviderId,
        acmeAccountId: account.id,
        domains: { create: domains.map((domain) => ({ domain })) },
      },
    });
    const actor = actorFrom(request);
    await recordAudit(prisma, actor, {
      action: "CREATE",
      entityType: "Certificate",
      entityId: certificate.id,
      summary: `Certificado ACME solicitado para ${domains.join(", ")}`,
    });
    acme.startIssue(certificate.id, actor, false);
    return reply.status(202).send(await load(certificate.id));
  });

  app.post("/certificates/custom", async (request, reply) => {
    const input = parse(customSchema, request.body);
    const parsed = parseCertificate(input.certificatePem, input.chainPem);
    const privateKeyPem = assertKeyMatches(parsed.certificatePem, input.privateKeyPem);
    const domains = parsed.domains.flatMap((domain) => {
      try {
        return [sanitizeDomain(domain)];
      } catch {
        return [];
      }
    });
    const status = parsed.notAfter < new Date() ? "EXPIRED" : "VALID";
    const created = await config.change(actorFrom(request), `Enviar certificado ${input.name}`, async (tx) => {
      const certificate = await tx.certificate.create({
        data: {
          name: input.name,
          type: "CUSTOM",
          status,
          autoRenew: false,
          certificatePem: parsed.certificatePem,
          chainPem: parsed.chainPem,
          privateKeyEncrypted: secrets.encrypt(privateKeyPem),
          issuer: parsed.issuer,
          serialNumber: parsed.serialNumber,
          fingerprint: parsed.fingerprint,
          notBefore: parsed.notBefore,
          notAfter: parsed.notAfter,
          domains: { create: [...new Set(domains)].map((domain) => ({ domain })) },
        },
      });
      return {
        result: certificate.id,
        audit: { action: "CREATE", entityType: "Certificate", entityId: certificate.id, summary: `Certificado customizado ${input.name} enviado (${domains.join(", ")})` },
      };
    });
    return reply.status(201).send(await load(created));
  });

  app.post("/certificates/:id/renew", async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const certificate = await load(id);
    if (certificate.type !== "ACME") throw badRequest("Apenas certificados ACME podem ser renovados automaticamente.");
    acme.startIssue(id, actorFrom(request), certificate.status === "VALID" || certificate.status === "EXPIRED");
    return reply.status(202).send({ ...certificate, issuing: true });
  });

  app.patch("/certificates/:id", async (request) => {
    const { id } = parse(idParams, request.params);
    const input = parse(updateSchema, request.body);
    const before = await load(id);
    await prisma.certificate.update({ where: { id }, data: input });
    await recordAudit(prisma, actorFrom(request), {
      action: "UPDATE",
      entityType: "Certificate",
      entityId: id,
      summary: `Certificado ${before.name} atualizado`,
      before: { name: before.name, autoRenew: before.autoRenew },
      after: input,
    });
    return load(id);
  });

  app.delete("/certificates/:id", async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const before = await load(id);
    if (before.hosts.length > 0) {
      throw conflict(`O certificado está em uso por: ${before.hosts.map((host) => host.name).join(", ")}.`);
    }
    if (acme.isRunning(id)) throw conflict("A emissão deste certificado ainda está em andamento.");
    await config.change(actorFrom(request), `Excluir certificado ${before.name}`, async (tx) => {
      await tx.certificate.delete({ where: { id } });
      return { result: null, audit: { action: "DELETE", entityType: "Certificate", entityId: id, summary: `Certificado ${before.name} excluído`, before } };
    });
    return reply.status(204).send();
  });
}
