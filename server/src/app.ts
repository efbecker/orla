import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppContext } from "./context.js";
import { analyticsRoutes } from "./modules/analytics.js";
import { authRealmRoutes } from "./modules/auth-realms.js";
import { authRoutes } from "./modules/auth.js";
import { certificateRoutes } from "./modules/certificates.js";
import { dnsProviderRoutes } from "./modules/dns-providers.js";
import { hostRuleRoutes } from "./modules/host-rules.js";
import { hostRoutes } from "./modules/hosts.js";
import { ipListRoutes } from "./modules/ip-lists.js";
import { logRoutes } from "./modules/logs.js";
import { systemRoutes } from "./modules/system.js";
import { upstreamRoutes } from "./modules/upstreams.js";
import { userRoutes } from "./modules/users.js";
import { registerAuth } from "./plugins/auth.js";
import { registerErrorHandler } from "./plugins/errors.js";

const DEFAULT_WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

/** Serves the built panel (SPA) with history fallback; API routes stay JSON. */
async function registerWeb(app: FastifyInstance, webDir: string): Promise<void> {
  const hasSpa = existsSync(path.join(webDir, "index.html"));

  app.setNotFoundHandler((request, reply) => {
    const isPage = (request.method === "GET" || request.method === "HEAD") && !request.url.startsWith("/api/") && request.url !== "/api";
    if (hasSpa && isPage && !path.extname(request.url.split("?")[0] ?? "")) {
      void reply.header("cache-control", "no-cache").sendFile("index.html");
      return;
    }
    void reply.status(404).send({ error: "NOT_FOUND", message: `Rota não encontrada: ${request.method} ${request.url}` });
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!reply.hasHeader(name)) void reply.header(name, value);
    }
    return payload;
  });

  if (!hasSpa) {
    app.log.warn({ webDir }, "panel build not found; serving the API only");
    app.get("/", { config: { public: true } }, async () => ({ name: "Orla", api: "/api" }));
    return;
  }

  await app.register(fastifyStatic, {
    root: webDir,
    index: ["index.html"],
    cacheControl: false,
    setHeaders: (response, filePath) => {
      const immutable = filePath.includes(`${path.sep}assets${path.sep}`);
      response.setHeader("cache-control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
    },
  });
}

export async function buildApp(context: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: context.env.LOG_LEVEL,
      redact: ["req.headers.authorization", "req.headers.cookie", "req.query.access_token"],
    },
    trustProxy: context.env.ORLA_TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
  });

  // Accepts an empty JSON body (action endpoints such as POST /system/apply);
  // anything else goes through Fastify's parser, which rejects prototype poisoning.
  const parseJson = app.getDefaultJsonParser("error", "error");
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const text = typeof body === "string" ? body : body.toString("utf8");
    if (text.trim() === "") {
      done(null, undefined);
      return;
    }
    parseJson(request, text, done);
  });

  app.decorate("orla", context);
  registerErrorHandler(app);
  await registerAuth(app, context.env.ORLA_JWT_SECRET, context.env.ORLA_COOKIE_SECURE);

  await registerWeb(app, context.env.ORLA_WEB_DIR ?? DEFAULT_WEB_DIR);

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(userRoutes);
      await api.register(systemRoutes);
      await api.register(hostRoutes);
      await api.register(hostRuleRoutes);
      await api.register(upstreamRoutes);
      await api.register(ipListRoutes);
      await api.register(authRealmRoutes);
      await api.register(certificateRoutes);
      await api.register(dnsProviderRoutes);
      await api.register(analyticsRoutes);
      await api.register(logRoutes);
    },
    { prefix: "/api" },
  );

  return app;
}
