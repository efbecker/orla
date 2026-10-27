import { PrismaClient } from "@prisma/client";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import type { AppContext } from "./context.js";
import { LogCollector } from "./jobs/log-collector.js";
import { pruneHistory, renewCertificates } from "./jobs/maintenance-jobs.js";
import { Scheduler } from "./jobs/scheduler.js";
import { SecretBox } from "./lib/crypto.js";
import { hashPanelPassword } from "./lib/passwords.js";
import { NginxConfigExecutor } from "./nginx/executor.js";
import type { NginxPaths } from "./nginx/types.js";
import { AcmeService } from "./services/acme.js";
import { recordAudit, SYSTEM_ACTOR } from "./services/audit.js";
import { CachePurger } from "./services/cache-purger.js";
import { ConfigService } from "./services/config-service.js";
import { LiveLogHub } from "./services/live-logs.js";
import { SettingsService } from "./services/settings.js";

const MINUTE = 60_000;

async function main(): Promise<void> {
  const env = loadEnv();
  const prisma = new PrismaClient();
  const secrets = new SecretBox(env.ORLA_ENCRYPTION_KEY);
  const paths: NginxPaths = {
    hostsDir: env.ORLA_NGINX_HOSTS_DIR,
    generatedDir: env.ORLA_NGINX_GENERATED_DIR,
    snippetsDir: env.ORLA_NGINX_SNIPPETS_DIR,
    acmeWebroot: env.ORLA_ACME_WEBROOT,
    systemCaBundle: env.ORLA_SYSTEM_CA_BUNDLE,
  };
  const executor = new NginxConfigExecutor({
    roots: { hosts: paths.hostsDir, generated: paths.generatedDir },
    testCommand: env.ORLA_NGINX_TEST_COMMAND,
    reloadCommand: env.ORLA_NGINX_RELOAD_COMMAND,
  });

  // The logger is created by Fastify; services log through it once the app exists.
  const logger = {
    info: (obj: object, msg?: string) => app.log.info(obj, msg),
    error: (obj: object, msg?: string) => app.log.error(obj, msg),
  };
  const settings = new SettingsService(prisma, secrets, { acmeEmail: env.ORLA_ACME_EMAIL });
  const config = new ConfigService({ prisma, executor, secrets, paths, runtimeDir: env.ORLA_NGINX_RUNTIME_DIR, logger });
  const acme = new AcmeService({ prisma, secrets, settings, config, acmeWebroot: paths.acmeWebroot, logger });
  const liveLogs = new LiveLogHub({ access: env.ORLA_NGINX_ACCESS_LOG, error: env.ORLA_NGINX_ERROR_LOG });

  const context: AppContext = {
    env,
    prisma,
    secrets,
    paths,
    executor,
    config,
    settings,
    acme,
    cachePurger: new CachePurger(env.ORLA_CACHE_PURGE_COMMAND),
    liveLogs,
  };
  const app = await buildApp(context);

  await ensureInitialAdmin(context, app.log);

  // The database is the source of truth: recompile everything on start so
  // Nginx always matches it (including after a quarantine at boot).
  await config.sync("BOOT", null, "Sincronização na inicialização").catch((error: unknown) => {
    app.log.error({ err: error }, "initial nginx sync failed; nginx keeps its previous configuration");
  });

  const scheduler = new Scheduler(app.log);
  const collector = new LogCollector(prisma, env.ORLA_NGINX_ACCESS_LOG);
  scheduler.every("log-collector", 5_000, async () => {
    await collector.collect();
  });
  scheduler.every("certificate-renewal", 12 * 60 * MINUTE, () => renewCertificates(prisma, acme, settings), { runImmediately: true });
  scheduler.every("history-retention", 60 * MINUTE, () => pruneHistory(prisma, settings), { runImmediately: true });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    scheduler.stop();
    liveLogs.close();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ host: env.ORLA_PANEL_HOST, port: env.ORLA_PANEL_PORT });
}

async function ensureInitialAdmin(context: AppContext, log: { info(obj: object, msg?: string): void; warn(msg: string): void }) {
  const { prisma, env } = context;
  if ((await prisma.user.count()) > 0) return;
  if (!env.ORLA_ADMIN_EMAIL || !env.ORLA_ADMIN_PASSWORD) {
    log.warn("no users exist and ORLA_ADMIN_EMAIL / ORLA_ADMIN_PASSWORD are not set; the panel cannot be used yet");
    return;
  }
  const user = await prisma.user.create({
    data: {
      email: env.ORLA_ADMIN_EMAIL.toLowerCase(),
      name: "Administrador",
      role: "ADMIN",
      passwordHash: await hashPanelPassword(env.ORLA_ADMIN_PASSWORD),
    },
  });
  await recordAudit(prisma, SYSTEM_ACTOR, {
    action: "CREATE",
    entityType: "User",
    entityId: user.id,
    summary: `Administrador inicial ${user.email} criado`,
  });
  log.info({ email: user.email }, "initial administrator created");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
