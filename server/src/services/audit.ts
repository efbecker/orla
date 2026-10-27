import type { AuditAction, Prisma } from "@prisma/client";
import type { DbClient } from "../nginx/loader.js";

export interface Actor {
  userId: number | null;
  email: string | null;
  ipAddress?: string;
  userAgent?: string;
}

export const SYSTEM_ACTOR: Actor = { userId: null, email: "sistema" };

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | number | null;
  summary: string;
  before?: unknown;
  after?: unknown;
}

const SECRET_FIELDS = new Set([
  "passwordHash",
  "privateKeyEncrypted",
  "accountKeyEncrypted",
  "eabHmacKeyEncrypted",
  "credentialsEncrypted",
  "tokenHash",
  "certificatePem",
  "chainPem",
  "originTrustedCaPem",
  "maintenanceHtml",
]);

/** JSON copy of a record without secrets or bulky PEM/HTML blobs. */
export function redact(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (key, item) => {
      if (SECRET_FIELDS.has(key)) return item ? "[omitido]" : item;
      if (typeof item === "bigint") return Number(item);
      return item;
    }),
  ) as Prisma.InputJsonValue;
}

export async function recordAudit(db: DbClient, actor: Actor, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: actor.userId,
      actorEmail: actor.email,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId === undefined || entry.entityId === null ? null : String(entry.entityId),
      summary: entry.summary,
      before: redact(entry.before),
      after: redact(entry.after),
      ipAddress: actor.ipAddress ?? null,
      userAgent: actor.userAgent?.slice(0, 512) ?? null,
    },
  });
}
