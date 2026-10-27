import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

/** Splits a command line into argv without a shell (no quoting support). */
const commandFromString = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.split(/\s+/));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().url(),

  ORLA_PANEL_HOST: z.string().default("0.0.0.0"),
  ORLA_PANEL_PORT: z.coerce.number().int().min(1).max(65535).default(81),
  ORLA_TRUST_PROXY: booleanFromString.default("false"),
  ORLA_COOKIE_SECURE: booleanFromString.default("false"),

  ORLA_JWT_SECRET: z.string().min(32, "ORLA_JWT_SECRET deve ter pelo menos 32 caracteres"),
  ORLA_ENCRYPTION_KEY: z
    .string()
    .refine(
      (value) => Buffer.from(value, "base64").length === 32,
      "ORLA_ENCRYPTION_KEY deve ser uma chave de 32 bytes em base64",
    ),

  ORLA_ADMIN_EMAIL: z.string().email().optional(),
  ORLA_ADMIN_PASSWORD: z.string().min(10).optional(),
  ORLA_ACME_EMAIL: z.string().email().optional(),

  ORLA_NGINX_HOSTS_DIR: z.string().default("/etc/nginx/conf.d"),
  ORLA_NGINX_GENERATED_DIR: z.string().default("/etc/nginx/orla/generated"),
  ORLA_NGINX_SNIPPETS_DIR: z.string().default("/etc/nginx/orla/snippets"),
  ORLA_NGINX_RUNTIME_DIR: z.string().default("/etc/nginx/orla/runtime"),
  ORLA_ACME_WEBROOT: z.string().default("/var/lib/orla/acme"),
  ORLA_NGINX_ACCESS_LOG: z.string().default("/var/log/orla/nginx/access.json"),
  ORLA_NGINX_ERROR_LOG: z.string().default("/var/log/orla/nginx/error.log"),
  ORLA_SYSTEM_CA_BUNDLE: z.string().default("/etc/ssl/certs/ca-certificates.crt"),

  ORLA_NGINX_TEST_COMMAND: commandFromString.default("sudo -n /usr/sbin/nginx -t"),
  ORLA_NGINX_RELOAD_COMMAND: commandFromString.default("sudo -n /usr/bin/systemctl reload nginx.service"),
  ORLA_CACHE_PURGE_COMMAND: commandFromString.default("sudo -n /usr/lib/orla/bin/orla-cache-purge"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Configuração inválida em /etc/orla/orla.env:\n${details}`);
  }
  return parsed.data;
}
