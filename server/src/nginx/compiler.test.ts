import { describe, expect, it } from "vitest";
import { compileConfig, previewHostConfig } from "./compiler.js";
import { ConfigValidationError } from "./errors.js";
import { buildRedirect, originScheme } from "./templates/host.js";
import * as fx from "./__fixtures__/graph.js";

const PEM_CERT = "-----BEGIN CERTIFICATE-----\nMIIBAA==\n-----END CERTIFICATE-----";
const PEM_KEY = "-----BEGIN PRIVATE KEY-----\nMIIBAA==\n-----END PRIVATE KEY-----";

function hostFile(snapshot = fx.snapshot(), caps = {}): string {
  const files = compileConfig(snapshot, fx.options(caps));
  const file = files.find((candidate) => candidate.root === "hosts");
  if (!file) throw new Error("host file missing");
  return file.content;
}

describe("compileConfig", () => {
  it("is deterministic", () => {
    const a = compileConfig(fx.snapshot(), fx.options());
    const b = compileConfig(fx.snapshot(), fx.options());
    expect(a).toEqual(b);
  });

  it("renders a plain HTTP proxy host", () => {
    const conf = hostFile();
    expect(conf).toContain("server_name site1.example.com;");
    expect(conf).toContain("set $orla_host_id 1;");
    expect(conf).toContain("proxy_pass http://orla_pool_1;");
    expect(conf).toContain("include /etc/nginx/orla/snippets/edge-protection.conf;");
    expect(conf).toContain("include /etc/nginx/orla/snippets/acme-challenge.conf;");
    expect(conf).not.toContain("listen 443");
  });

  it("renders upstream pools with load balancing and passive health checks", () => {
    const files = compileConfig(
      fx.snapshot({
        pools: [
          fx.pool({
            algorithm: "LEAST_CONN",
            servers: [
              { ...fx.pool().servers[0]!, id: 1, address: "10.0.0.1", weight: 3 },
              { ...fx.pool().servers[0]!, id: 2, address: "2001:db8::1", isBackup: true },
            ],
          }),
        ],
      }),
      fx.options(),
    );
    const upstreams = files.find((file) => file.path === "http.d/upstreams.conf")!.content;
    expect(upstreams).toContain("upstream orla_pool_1 {");
    expect(upstreams).toContain("least_conn;");
    expect(upstreams).toContain("server 10.0.0.1:8080 weight=3 max_fails=3 fail_timeout=10s;");
    expect(upstreams).toContain("server [2001:db8::1]:8080 weight=1 max_fails=3 fail_timeout=10s backup;");
  });

  it("rejects ip_hash with backup servers", () => {
    const servers = [{ ...fx.pool().servers[0]!, isBackup: true }];
    expect(() => compileConfig(fx.snapshot({ pools: [fx.pool({ algorithm: "IP_HASH", servers })] }), fx.options())).toThrow(
      ConfigValidationError,
    );
  });

  it("renders TLS, force HTTPS, HSTS, HTTP/2 and HTTP/3", () => {
    const conf = hostFile(
      fx.snapshot({
        hosts: [
          fx.host({
            sslMode: "FULL_STRICT",
            certificateId: 7,
            forceHttps: true,
            hstsEnabled: true,
            hstsIncludeSubdomains: true,
            http3Enabled: true,
            minTlsVersion: "TLS_1_3",
          }),
        ],
        certificates: [fx.certificate(7, PEM_CERT, PEM_KEY)],
      }),
    );
    expect(conf).toContain("return 301 \"https://$host$request_uri\";");
    expect(conf).toContain("listen 443 ssl;");
    expect(conf).toContain("listen 443 quic;");
    expect(conf).toContain("http3 on;");
    expect(conf).toContain("ssl_protocols TLSv1.3;");
    expect(conf).toContain("ssl_certificate /etc/nginx/orla/generated/certs/7/fullchain.pem;");
    expect(conf).toContain('more_set_headers "Strict-Transport-Security: max-age=31536000; includeSubDomains";');
    expect(conf).toContain("more_set_headers 'Alt-Svc: h3=\":443\"; ma=86400';");
    expect(conf).toContain("proxy_pass https://orla_pool_1;");
    expect(conf).toContain("proxy_ssl_verify on;");
    expect(conf).toContain("proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;");
  });

  it("omits optional features the Nginx build lacks", () => {
    const conf = hostFile(
      fx.snapshot({
        hosts: [fx.host({ sslMode: "FLEXIBLE", certificateId: 7, http3Enabled: true, brotliEnabled: true, hstsEnabled: true })],
        certificates: [fx.certificate(7, PEM_CERT, PEM_KEY)],
      }),
      { http3: false, brotli: false, headersMore: false, ipv6: false },
    );
    expect(conf).not.toContain("quic");
    expect(conf).not.toContain("brotli");
    expect(conf).not.toContain("[::]");
    expect(conf).toContain('add_header Strict-Transport-Security "max-age=31536000" always;');
    expect(conf).toContain("proxy_pass http://orla_pool_1;");
  });

  it("requires a certificate when SSL is on", () => {
    expect(() => hostFile(fx.snapshot({ hosts: [fx.host({ sslMode: "FULL" })] }))).toThrow(ConfigValidationError);
  });

  it("renders maintenance mode and skips the proxy", () => {
    const files = compileConfig(fx.snapshot({ hosts: [fx.host({ maintenanceEnabled: true, maintenanceTitle: "<Volto já>" })] }), fx.options());
    const conf = files.find((file) => file.root === "hosts")!.content;
    expect(conf).toContain("error_page 503 /__orla_maintenance.html;");
    expect(conf).toContain("return 503;");
    expect(conf).not.toContain("proxy_pass");
    const page = files.find((file) => file.path === "www/maintenance-1.html")!.content;
    expect(page).toContain("&lt;Volto já&gt;");
  });

  it("routes custom locations and keeps a default route", () => {
    const conf = hostFile(
      fx.snapshot({
        hosts: [
          fx.host({
            locations: [
              fx.location({ id: 1, path: "/api/", upstreamPoolId: 2, rewritePath: "/" }),
              fx.location({ id: 2, path: "^/img/.*\\.png$", matchType: "REGEX_CASE_INSENSITIVE", websocketEnabled: true }),
            ],
          }),
        ],
        pools: [fx.pool(), fx.pool({ id: 2, name: "api", scheme: "HTTPS" })],
      }),
    );
    expect(conf).toContain("location /api/ {");
    expect(conf).toContain("proxy_pass https://orla_pool_2/;");
    expect(conf).toContain('location ~* "^/img/.*\\.png$" {');
    expect(conf).toContain("proxy_set_header Upgrade $http_upgrade;");
    expect(conf).toMatch(/location \/ \{[\s\S]*proxy_pass http:\/\/orla_pool_1;/);
  });

  it("rejects duplicated routes", () => {
    const locations = [fx.location({ id: 1 }), fx.location({ id: 2 })];
    expect(() => hostFile(fx.snapshot({ hosts: [fx.host({ locations })] }))).toThrow(ConfigValidationError);
  });

  it("renders redirect rules that skip ACME challenges", () => {
    const rule = {
      id: 3,
      hostId: 1,
      name: "Blog antigo",
      enabled: true,
      matchType: "PREFIX" as const,
      sourcePath: "/blog",
      targetUrl: "https://blog.example.com/",
      statusCode: "FOUND_302" as const,
      preservePath: true,
      preserveQuery: true,
      priority: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const conf = hostFile(fx.snapshot({ hosts: [fx.host({ redirectRules: [rule] })] }));
    expect(conf).toContain("if ($orla_is_acme) {");
    expect(conf).toContain('if ($uri ~ "^\\/blog(/.*)?$" ) {');
    expect(conf).toContain('return 302 "https://blog.example.com$1$is_args$args";');
  });

  it("renders headers, rate limits, IP lists, basic auth and cache", () => {
    const now = new Date();
    const header = (id: number, phase: "REQUEST" | "RESPONSE", operation: "SET" | "ADD" | "REMOVE", headerName: string, headerValue: string | null) => ({
      id,
      hostId: 1,
      locationId: null,
      phase,
      operation,
      headerName,
      headerValue,
      always: false,
      priority: 0,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    const snapshot = fx.snapshot({
      hosts: [
        fx.host({
          cacheEnabled: true,
          securityHeadersEnabled: true,
          blockBadBotsEnabled: true,
          authMode: "BASIC",
          basicAuthRealmId: 4,
          headerRules: [
            header(1, "REQUEST", "SET", "X-Tenant", "acme"),
            header(2, "RESPONSE", "REMOVE", "X-Powered-By", null),
            header(3, "RESPONSE", "SET", "X-Frame-Options", "DENY"),
          ],
          rateLimitRules: [
            {
              id: 9,
              hostId: 1,
              locationId: null,
              name: "Login",
              enabled: true,
              key: "IP",
              requests: 10,
              period: "MINUTE",
              burst: 5,
              nodelay: true,
              zoneSizeMb: 10,
              createdAt: now,
              updatedAt: now,
            },
          ],
          ipLists: [
            { hostId: 1, ipListId: 1, priority: 0 },
            { hostId: 1, ipListId: 2, priority: 1 },
          ],
        }),
      ],
      ipLists: [
        { id: 1, name: "Escritório", description: null, type: "ALLOWLIST", createdAt: now, updatedAt: now, entries: [{ id: 1, ipListId: 1, cidr: "203.0.113.0/24", comment: null, createdAt: now }] },
        { id: 2, name: "Bloqueados", description: null, type: "BLOCKLIST", createdAt: now, updatedAt: now, entries: [{ id: 2, ipListId: 2, cidr: "198.51.100.7", comment: null, createdAt: now }] },
      ],
      realms: [
        {
          id: 4,
          name: "Equipe",
          realm: "Área restrita",
          description: null,
          createdAt: now,
          updatedAt: now,
          users: [{ id: 1, realmId: 4, username: "ana", passwordHash: `$2b$10$${"a".repeat(53)}`, hashAlgorithm: "BCRYPT", createdAt: now, updatedAt: now }],
        },
      ],
    });
    const files = compileConfig(snapshot, fx.options());
    const conf = files.find((file) => file.root === "hosts")!.content;

    expect(conf).toContain('proxy_set_header X-Tenant "acme";');
    expect(conf).toContain("more_clear_headers X-Powered-By;");
    expect(conf).toContain('more_set_headers "X-Frame-Options: DENY";');
    expect(conf).toContain("limit_req zone=orla_rl_9 burst=5 nodelay;");
    expect(conf.indexOf("ip-lists/list-2.conf")).toBeLessThan(conf.indexOf("ip-lists/list-1.conf"));
    expect(conf).toContain("deny all;");
    expect(conf).toContain('auth_basic "Área restrita";');
    expect(conf).toContain("proxy_cache orla_cache;");
    expect(conf).toContain("$orla_is_dynamic");
    expect(conf).toContain("include /etc/nginx/orla/snippets/block-bad-bots.conf;");

    const zones = files.find((file) => file.path === "http.d/rate-limits.conf")!.content;
    expect(zones).toContain("limit_req_zone $binary_remote_addr zone=orla_rl_9:10m rate=10r/m;");
    expect(files.find((file) => file.path === "ip-lists/list-1.conf")!.content).toContain("allow 203.0.113.0/24;");
    expect(files.find((file) => file.path === "htpasswd/realm-4")!.content).toBe(`ana:$2b$10$${"a".repeat(53)}\n`);
  });

  it("drops protection layers when edge protection is off", () => {
    const conf = hostFile(fx.snapshot({ hosts: [fx.host({ edgeProtectionEnabled: false, cacheEnabled: true, securityHeadersEnabled: true })] }));
    expect(conf).not.toContain("edge-protection.conf");
    expect(conf).not.toContain("proxy_cache");
    expect(conf).not.toContain("X-Frame-Options");
  });

  it("skips disabled hosts and rejects duplicated domains", () => {
    const files = compileConfig(fx.snapshot({ hosts: [fx.host({ enabled: false })] }), fx.options());
    expect(files.some((file) => file.root === "hosts")).toBe(false);

    const duplicate = fx.host({ id: 2, domains: [{ id: 99, hostId: 2, domain: "site1.example.com", isPrimary: true, createdAt: new Date() }] });
    expect(() => compileConfig(fx.snapshot({ hosts: [fx.host(), duplicate] }), fx.options())).toThrow(ConfigValidationError);
  });

  it("previews a single host", () => {
    expect(previewHostConfig(fx.host(), fx.snapshot(), fx.options())).toContain("server_name site1.example.com;");
  });
});

describe("helpers", () => {
  it("maps SSL modes to origin schemes", () => {
    expect(originScheme("FLEXIBLE", "HTTPS")).toBe("http");
    expect(originScheme("FULL", "HTTP")).toBe("https");
    expect(originScheme("OFF", "HTTPS")).toBe("https");
  });

  it("builds redirects for every match type", () => {
    const base = { targetUrl: "https://n.com/x", preservePath: false, preserveQuery: false };
    expect(buildRedirect({ ...base, matchType: "EXACT", sourcePath: "/a.html" }).regex).toBe("^\\/a\\.html$");
    expect(buildRedirect({ ...base, matchType: "WILDCARD", sourcePath: "/p/*", targetUrl: "https://n.com/$1" }).target).toBe("https://n.com/$1");
    expect(buildRedirect({ ...base, matchType: "REGEX_CASE_INSENSITIVE", sourcePath: "^/old$" }).operator).toBe("~*");
    expect(() => buildRedirect({ ...base, matchType: "PREFIX", sourcePath: "/", targetUrl: "https://n.com/?a=1", preserveQuery: true })).toThrow(ConfigValidationError);
  });
});
