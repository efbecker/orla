/*
 * Renders a feature-complete sample configuration into a directory laid out
 * like /etc/nginx, used to validate the compiler output against a real
 * `nginx -t`:  tsx render-sample.ts <outDir> <cert.pem> <key.pem>
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { compileConfig } from "../compiler.js";
import * as fx from "./graph.js";

const [outDir = "out", certPath = "cert.pem", keyPath = "key.pem", capsJson = "{}"] = process.argv.slice(2);
const now = new Date();
const cert = await readFile(certPath, "utf8");
const key = await readFile(keyPath, "utf8");

const header = (id: number, locationId: number | null, phase: "REQUEST" | "RESPONSE", operation: "SET" | "ADD" | "REMOVE", headerName: string, headerValue: string | null) => ({
  id, hostId: 1, locationId, phase, operation, headerName, headerValue, always: true, priority: 0, enabled: true, createdAt: now, updatedAt: now,
});
const rateRule = (id: number, locationId: number | null) => ({
  id, hostId: 1, locationId, name: `r${id}`, enabled: true, key: "IP_AND_PATH" as const, requests: 5, period: "SECOND" as const, burst: 10, nodelay: false, zoneSizeMb: 5, createdAt: now, updatedAt: now,
});

const snapshot = fx.snapshot({
  hosts: [
    fx.host({
      sslMode: "FULL_STRICT",
      certificateId: 1,
      forceHttps: false,
      hstsEnabled: true,
      hstsPreload: true,
      http3Enabled: true,
      brotliEnabled: true,
      websocketEnabled: true,
      cacheEnabled: true,
      cacheRespectOriginHeaders: false,
      securityHeadersEnabled: true,
      contentSecurityPolicy: "default-src 'self'; img-src * data:",
      blockBadBotsEnabled: true,
      authMode: "EXTERNAL",
      externalAuthUrl: "http://127.0.0.1:9000/verify",
      originServerName: "origin.internal",
      originTrustedCaPem: cert,
      customDirectives: "location = /healthz {\n    return 200 \"ok\";\n}",
      domains: [
        { id: 1, hostId: 1, domain: "site1.example.com", isPrimary: true, createdAt: now },
        { id: 2, hostId: 1, domain: "*.site1.example.com", isPrimary: false, createdAt: now },
      ],
      headerRules: [header(1, null, "REQUEST", "SET", "X-Tenant", "acme"), header(2, null, "RESPONSE", "REMOVE", "Server", null), header(3, null, "RESPONSE", "ADD", "X-Edge", "orla")],
      rateLimitRules: [rateRule(1, null), rateRule(2, 1)],
      ipLists: [{ hostId: 1, ipListId: 2, priority: 0 }],
      redirectRules: [
        { id: 1, hostId: 1, name: "exato", enabled: true, matchType: "EXACT", sourcePath: "/velho.html", targetUrl: "https://site1.example.com/novo", statusCode: "MOVED_PERMANENTLY_301", preservePath: false, preserveQuery: true, priority: 3, createdAt: now, updatedAt: now },
        { id: 2, hostId: 1, name: "prefixo", enabled: true, matchType: "PREFIX", sourcePath: "/blog/", targetUrl: "https://blog.example.com/", statusCode: "TEMPORARY_REDIRECT_307", preservePath: true, preserveQuery: false, priority: 2, createdAt: now, updatedAt: now },
        { id: 3, hostId: 1, name: "curinga", enabled: true, matchType: "WILDCARD", sourcePath: "/u/*/perfil", targetUrl: "https://site1.example.com/perfil/$1", statusCode: "PERMANENT_REDIRECT_308", preservePath: false, preserveQuery: true, priority: 1, createdAt: now, updatedAt: now },
        { id: 4, hostId: 1, name: "regex", enabled: true, matchType: "REGEX_CASE_INSENSITIVE", sourcePath: "^/produto/([0-9]+)$", targetUrl: "https://loja.example.com/p/$1", statusCode: "FOUND_302", preservePath: false, preserveQuery: true, priority: 0, createdAt: now, updatedAt: now },
      ],
      locations: [
        fx.location({ id: 1, path: "/api/", upstreamPoolId: 2, rewritePath: "/v1/", authMode: "BASIC", basicAuthRealmId: 1, clientMaxBodySizeMb: 50, rateLimitRules: [rateRule(2, 1)], headerRules: [header(4, 1, "RESPONSE", "SET", "Cache-Control", "no-store")], ipLists: [{ locationId: 1, ipListId: 1, priority: 0 }] }),
        fx.location({ id: 2, path: "/ws", matchType: "EXACT", websocketEnabled: true, cacheEnabled: false, authMode: "NONE" }),
        fx.location({ id: 3, path: "/static/*.css", matchType: "WILDCARD" }),
        fx.location({ id: 4, path: "\\.(png|jpe?g)$", matchType: "REGEX_CASE_INSENSITIVE", customDirectives: "expires 7d;" }),
      ],
    }),
    fx.host({ id: 2, sslMode: "FLEXIBLE", certificateId: 1, forceHttps: true, maintenanceEnabled: true, maintenanceMessage: "Voltamos às 18h" }),
    fx.host({ id: 3, upstreamPoolId: null, edgeProtectionEnabled: false, redirectRules: [{ id: 5, hostId: 3, name: "dominio inteiro", enabled: true, matchType: "PREFIX", sourcePath: "/", targetUrl: "https://www.example.com", statusCode: "MOVED_PERMANENTLY_301", preservePath: true, preserveQuery: true, priority: 0, createdAt: now, updatedAt: now }] }),
  ],
  pools: [
    fx.pool({ id: 1, algorithm: "IP_HASH" }),
    fx.pool({ id: 2, name: "api", scheme: "HTTPS", algorithm: "LEAST_CONN", servers: [
      { ...fx.pool().servers[0]!, id: 2, poolId: 2, address: "127.0.0.2", port: 8443, weight: 5 },
      { ...fx.pool().servers[0]!, id: 3, poolId: 2, address: "::1", port: 8443, isBackup: true },
      { ...fx.pool().servers[0]!, id: 4, poolId: 2, address: "localhost", port: 9443, isDown: true },
    ] }),
  ],
  ipLists: [
    { id: 1, name: "vpn", description: null, type: "ALLOWLIST", createdAt: now, updatedAt: now, entries: [{ id: 1, ipListId: 1, cidr: "10.8.0.0/16", comment: null, createdAt: now }, { id: 2, ipListId: 1, cidr: "2001:db8::/32", comment: null, createdAt: now }] },
    { id: 2, name: "bloqueio", description: null, type: "BLOCKLIST", createdAt: now, updatedAt: now, entries: [{ id: 3, ipListId: 2, cidr: "198.51.100.0/24", comment: null, createdAt: now }] },
  ],
  realms: [{ id: 1, name: "time", realm: "Área restrita", description: null, createdAt: now, updatedAt: now, users: [{ id: 1, realmId: 1, username: "ana", passwordHash: "$apr1$abcdefgh$0123456789abcdefghijkl", hashAlgorithm: "APR1", createdAt: now, updatedAt: now }] }],
  certificates: [fx.certificate(1, cert, key)],
});

const files = compileConfig(snapshot, fx.options(JSON.parse(capsJson)));
for (const file of files) {
  const target = path.join(outDir, file.root === "hosts" ? "conf.d" : "orla/generated", file.path);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, file.content, { mode: file.mode });
}
console.log(files.map((file) => `${file.root}/${file.path}`).join("\n"));
