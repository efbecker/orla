import type { PrismaClient } from "@prisma/client";
import type { Env } from "./config/env.js";
import type { SecretBox } from "./lib/crypto.js";
import type { NginxConfigExecutor } from "./nginx/executor.js";
import type { NginxPaths } from "./nginx/types.js";
import type { AcmeService } from "./services/acme.js";
import type { CachePurger } from "./services/cache-purger.js";
import type { ConfigService } from "./services/config-service.js";
import type { LiveLogHub } from "./services/live-logs.js";
import type { SettingsService } from "./services/settings.js";

/** Services shared by every route, available as `app.orla`. */
export interface AppContext {
  env: Env;
  prisma: PrismaClient;
  secrets: SecretBox;
  paths: NginxPaths;
  executor: NginxConfigExecutor;
  config: ConfigService;
  settings: SettingsService;
  acme: AcmeService;
  cachePurger: CachePurger;
  liveLogs: LiveLogHub;
}

declare module "fastify" {
  interface FastifyInstance {
    orla: AppContext;
  }
}
