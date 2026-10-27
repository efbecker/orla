import type { PrismaClient } from "@prisma/client";
import type { AcmeService } from "../services/acme.js";
import type { SettingsService } from "../services/settings.js";

const DAY_MS = 86_400_000;
/** Minimum wait before retrying a failed renewal. */
const RETRY_AFTER_MS = 6 * 3_600_000;

/** Marks expired certificates and renews ACME certificates close to expiry. */
export async function renewCertificates(prisma: PrismaClient, acme: AcmeService, settings: SettingsService): Promise<void> {
  const now = new Date();
  await prisma.certificate.updateMany({ where: { status: "VALID", notAfter: { lt: now } }, data: { status: "EXPIRED" } });

  const { renewBeforeDays } = await settings.get();
  const due = await prisma.certificate.findMany({
    where: {
      type: "ACME",
      autoRenew: true,
      status: { in: ["VALID", "EXPIRED"] },
      notAfter: { lt: new Date(now.getTime() + renewBeforeDays * DAY_MS) },
      OR: [{ lastRenewAttemptAt: null }, { lastRenewAttemptAt: { lt: new Date(now.getTime() - RETRY_AFTER_MS) } }],
    },
    select: { id: true },
  });
  for (const certificate of due) {
    await acme.issue(certificate.id, undefined, true).catch(() => undefined);
  }
}

/** Prunes analytics, audit, deployment history and expired sessions. */
export async function pruneHistory(prisma: PrismaClient, settings: SettingsService): Promise<void> {
  const current = await settings.get();
  const now = Date.now();
  await prisma.trafficBucket.deleteMany({ where: { bucketStart: { lt: new Date(now - current.analyticsRetentionDays * DAY_MS) } } });
  await prisma.trafficTopEntry.deleteMany({ where: { bucketStart: { lt: new Date(now - current.analyticsRetentionDays * DAY_MS) } } });
  await prisma.auditLog.deleteMany({ where: { createdAt: { lt: new Date(now - current.auditRetentionDays * DAY_MS) } } });
  await prisma.deployment.deleteMany({ where: { startedAt: { lt: new Date(now - current.deploymentRetentionDays * DAY_MS) } } });
  await prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date(now) } }, { revokedAt: { lt: new Date(now - DAY_MS) } }] } });
}
