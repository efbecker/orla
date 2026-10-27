import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { SecretBox } from "../lib/crypto.js";

const SETTINGS_KEY = "panel";

export const settingsSchema = z.object({
  acmeEmail: z.string().email().nullable().default(null),
  acmeProvider: z.enum(["LETSENCRYPT", "LETSENCRYPT_STAGING", "ZEROSSL"]).default("LETSENCRYPT"),
  zerosslEabKeyId: z.string().max(256).nullable().default(null),
  /** Encrypted with SecretBox; never returned by the API. */
  zerosslEabHmacKeyEncrypted: z.string().nullable().default(null),
  renewBeforeDays: z.number().int().min(1).max(60).default(30),
  analyticsRetentionDays: z.number().int().min(1).max(365).default(30),
  auditRetentionDays: z.number().int().min(7).max(3650).default(365),
  deploymentRetentionDays: z.number().int().min(7).max(3650).default(90),
});

export type PanelSettings = z.infer<typeof settingsSchema>;

export const settingsUpdateSchema = z
  .object({
    acmeEmail: z.string().email().nullable(),
    acmeProvider: z.enum(["LETSENCRYPT", "LETSENCRYPT_STAGING", "ZEROSSL"]),
    zerosslEabKeyId: z.string().trim().max(256).nullable(),
    zerosslEabHmacKey: z.string().trim().max(512).nullable(),
    renewBeforeDays: z.number().int().min(1).max(60),
    analyticsRetentionDays: z.number().int().min(1).max(365),
    auditRetentionDays: z.number().int().min(7).max(3650),
    deploymentRetentionDays: z.number().int().min(7).max(3650),
  })
  .partial();

export type PublicSettings = Omit<PanelSettings, "zerosslEabHmacKeyEncrypted"> & { zerosslEabHmacKeyConfigured: boolean };

export class SettingsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly secrets: SecretBox,
    private readonly defaults: { acmeEmail?: string },
  ) {}

  async get(): Promise<PanelSettings> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
    const parsed = settingsSchema.parse(row?.value ?? {});
    return { ...parsed, acmeEmail: parsed.acmeEmail ?? this.defaults.acmeEmail ?? null };
  }

  toPublic(settings: PanelSettings): PublicSettings {
    const { zerosslEabHmacKeyEncrypted, ...rest } = settings;
    return { ...rest, zerosslEabHmacKeyConfigured: zerosslEabHmacKeyEncrypted !== null };
  }

  async update(input: z.infer<typeof settingsUpdateSchema>): Promise<{ before: PanelSettings; after: PanelSettings }> {
    const before = await this.get();
    const { zerosslEabHmacKey, ...rest } = input;
    const after: PanelSettings = { ...before, ...rest };
    if (zerosslEabHmacKey !== undefined) {
      after.zerosslEabHmacKeyEncrypted = zerosslEabHmacKey ? this.secrets.encrypt(zerosslEabHmacKey) : null;
    }
    await this.prisma.setting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value: after },
      update: { value: after },
    });
    return { before, after };
  }

  decryptEabHmacKey(settings: PanelSettings): string | null {
    return settings.zerosslEabHmacKeyEncrypted ? this.secrets.decrypt(settings.zerosslEabHmacKeyEncrypted) : null;
  }
}
