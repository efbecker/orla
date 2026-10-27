import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import acme from "acme-client";
import type { AcmeProvider, PrismaClient } from "@prisma/client";
import type { SecretBox } from "../lib/crypto.js";
import type { ConfigService } from "./config-service.js";
import { recordAudit, SYSTEM_ACTOR, type Actor } from "./audit.js";
import { parseCertificate } from "./certificate-info.js";
import { createDnsSolver, dnsCredentialsSchema, type TxtRecordRef } from "./dns-providers.js";
import type { SettingsService } from "./settings.js";

const DIRECTORIES: Record<AcmeProvider, string> = {
  LETSENCRYPT: acme.directory.letsencrypt.production,
  LETSENCRYPT_STAGING: acme.directory.letsencrypt.staging,
  ZEROSSL: acme.directory.zerossl.production,
};

const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

interface AcmeServiceOptions {
  prisma: PrismaClient;
  secrets: SecretBox;
  settings: SettingsService;
  config: ConfigService;
  acmeWebroot: string;
  logger: { info(obj: object, msg?: string): void; error(obj: object, msg?: string): void };
}

/**
 * Native ACME client (acme-client): HTTP-01 through the shared webroot served
 * by every Nginx server on port 80, and DNS-01 through the DNS provider APIs
 * (required for wildcard certificates).
 */
export class AcmeService {
  private readonly running = new Set<number>();

  constructor(private readonly options: AcmeServiceOptions) {}

  isRunning(certificateId: number): boolean {
    return this.running.has(certificateId);
  }

  /** Starts issuance/renewal without blocking the request; progress is stored on the certificate. */
  startIssue(certificateId: number, actor: Actor, renewal: boolean): void {
    if (this.running.has(certificateId)) return;
    void this.issue(certificateId, actor, renewal).catch((error: unknown) => {
      this.options.logger.error({ err: error, certificateId }, "acme issuance failed");
    });
  }

  async issue(certificateId: number, actor: Actor = SYSTEM_ACTOR, renewal = false): Promise<void> {
    if (this.running.has(certificateId)) return;
    this.running.add(certificateId);
    const { prisma } = this.options;
    try {
      const certificate = await prisma.certificate.findUniqueOrThrow({
        where: { id: certificateId },
        include: { domains: { orderBy: { id: "asc" } }, dnsProvider: true },
      });
      if (certificate.type !== "ACME") throw new Error("Somente certificados ACME podem ser emitidos automaticamente.");
      await prisma.certificate.update({ where: { id: certificateId }, data: { lastRenewAttemptAt: new Date(), lastError: null } });

      const domains = certificate.domains.map((entry) => entry.domain);
      const account = certificate.acmeAccountId
        ? await prisma.acmeAccount.findUniqueOrThrow({ where: { id: certificate.acmeAccountId } })
        : await this.defaultAccount();
      const email = account.email;
      const client = new acme.Client({
        directoryUrl: account.directoryUrl,
        accountKey: this.options.secrets.decrypt(account.accountKeyEncrypted),
        accountUrl: account.accountUrl ?? undefined,
        externalAccountBinding: account.eabKeyId && account.eabHmacKeyEncrypted
          ? { kid: account.eabKeyId, hmacKey: this.options.secrets.decrypt(account.eabHmacKeyEncrypted) }
          : undefined,
      });

      const [privateKey, csr] = await acme.crypto.createCsr(
        { commonName: domains[0], altNames: domains },
        await acme.crypto.createPrivateEcdsaKey("P-256"),
      );

      const challengeType = certificate.challengeType ?? "HTTP_01";
      const dnsRecords = new Map<string, TxtRecordRef>();
      const solver =
        challengeType === "DNS_01"
          ? (() => {
              if (!certificate.dnsProvider?.credentialsEncrypted) {
                throw new Error("O certificado usa DNS-01, mas o provedor de DNS não tem credenciais.");
              }
              const credentials = dnsCredentialsSchema.parse(
                JSON.parse(this.options.secrets.decrypt(certificate.dnsProvider.credentialsEncrypted)),
              );
              return createDnsSolver(certificate.dnsProvider.type, credentials);
            })()
          : null;
      const propagationMs = (certificate.dnsProvider?.propagationSeconds ?? 60) * 1000;

      const pem = await client.auto({
        csr,
        email,
        termsOfServiceAgreed: true,
        challengePriority: [challengeType === "DNS_01" ? "dns-01" : "http-01"],
        challengeCreateFn: async (authz, challenge, keyAuthorization) => {
          if (challenge.type === "http-01") {
            await this.writeHttpToken(challenge.token, keyAuthorization);
            return;
          }
          if (!solver) throw new Error("Desafio DNS-01 sem provedor de DNS.");
          const fqdn = `_acme-challenge.${authz.identifier.value}`;
          dnsRecords.set(`${fqdn}:${keyAuthorization}`, await solver.createTxt(fqdn, keyAuthorization));
          await new Promise((resolve) => setTimeout(resolve, propagationMs));
        },
        challengeRemoveFn: async (authz, challenge, keyAuthorization) => {
          if (challenge.type === "http-01") {
            await this.removeHttpToken(challenge.token);
            return;
          }
          const key = `_acme-challenge.${authz.identifier.value}:${keyAuthorization}`;
          const ref = dnsRecords.get(key);
          if (solver && ref) {
            await solver.removeTxt(ref).catch((error: unknown) => {
              this.options.logger.error({ err: error }, "failed to remove dns-01 TXT record");
            });
            dnsRecords.delete(key);
          }
        },
      });

      if (!account.accountUrl) {
        await prisma.acmeAccount.update({ where: { id: account.id }, data: { accountUrl: client.getAccountUrl() } });
      }

      const parsed = parseCertificate(pem);
      await prisma.certificate.update({
        where: { id: certificateId },
        data: {
          status: "VALID",
          acmeAccountId: account.id,
          certificatePem: parsed.certificatePem,
          chainPem: parsed.chainPem,
          privateKeyEncrypted: this.options.secrets.encrypt(privateKey.toString()),
          issuer: parsed.issuer,
          serialNumber: parsed.serialNumber,
          fingerprint: parsed.fingerprint,
          notBefore: parsed.notBefore,
          notAfter: parsed.notAfter,
          lastError: null,
        },
      });
      await recordAudit(prisma, actor, {
        action: renewal ? "RENEW_CERTIFICATE" : "ISSUE_CERTIFICATE",
        entityType: "Certificate",
        entityId: certificateId,
        summary: `Certificado ${renewal ? "renovado" : "emitido"} para ${domains.join(", ")}`,
      });
      await this.options.config.sync(
        "CERTIFICATE_RENEWAL",
        actor.userId,
        `Certificado #${certificateId} ${renewal ? "renovado" : "emitido"}`,
      );
      this.options.logger.info({ certificateId, domains }, "acme certificate issued");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.certificate
        .update({
          where: { id: certificateId },
          data: { lastError: message.slice(0, 2000), status: renewal ? undefined : "ERROR" },
        })
        .catch(() => undefined);
      throw error;
    } finally {
      this.running.delete(certificateId);
    }
  }

  private async defaultAccount() {
    const settings = await this.options.settings.get();
    if (!settings.acmeEmail) throw new Error("Configure o e-mail ACME nas configurações antes de emitir certificados.");
    return this.ensureAccount(settings.acmeProvider, settings.acmeEmail);
  }

  /** Returns the ACME account for provider + e-mail, creating its key on first use. */
  async ensureAccount(provider: AcmeProvider, email: string) {
    const { prisma, secrets, settings } = this.options;
    const existing = await prisma.acmeAccount.findUnique({ where: { provider_email: { provider, email } } });
    if (existing) return existing;

    let eabKeyId: string | null = null;
    let eabHmacKeyEncrypted: string | null = null;
    if (provider === "ZEROSSL") {
      const current = await settings.get();
      const hmacKey = settings.decryptEabHmacKey(current);
      if (!current.zerosslEabKeyId || !hmacKey) {
        throw new Error("Para usar a ZeroSSL, informe as credenciais EAB (Key ID e HMAC Key) nas configurações.");
      }
      eabKeyId = current.zerosslEabKeyId;
      eabHmacKeyEncrypted = secrets.encrypt(hmacKey);
    }
    const accountKey = await acme.crypto.createPrivateEcdsaKey("P-256");
    return prisma.acmeAccount.create({
      data: {
        provider,
        email,
        directoryUrl: DIRECTORIES[provider],
        accountKeyEncrypted: secrets.encrypt(accountKey.toString()),
        eabKeyId,
        eabHmacKeyEncrypted,
      },
    });
  }

  private tokenPath(token: string): string {
    if (!TOKEN_PATTERN.test(token)) throw new Error("Token ACME inválido.");
    return path.join(this.options.acmeWebroot, token);
  }

  private async writeHttpToken(token: string, keyAuthorization: string): Promise<void> {
    await mkdir(this.options.acmeWebroot, { recursive: true });
    await writeFile(this.tokenPath(token), keyAuthorization, { mode: 0o644 });
  }

  private async removeHttpToken(token: string): Promise<void> {
    await rm(this.tokenPath(token), { force: true });
  }
}
