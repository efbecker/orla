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

  app.get("/", { config: { public: true } }, async () => ({ name: "Orla", api: "/api" }));

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
