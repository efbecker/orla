import type { AuthMode, HeaderRule, PathMatchType, RateLimitRule, RedirectRule } from "@prisma/client";
import type { NginxCapabilities } from "../capabilities.js";
import { blank, block, comment, constant, directive, quoted, trusted, verbatim, type ConfigNode, type Token } from "../builder.js";
import { ConfigValidationError } from "../errors.js";
import {
  escapeRegex,
  sanitizeCustomDirectives,
  sanitizeDomain,
  sanitizeHeaderName,
  sanitizeHeaderValue,
  sanitizePath,
  sanitizePem,
  sanitizeQuotedText,
  sanitizeRegex,
  sanitizeUrl,
  sanitizeWildcardPath,
  wildcardToRegex,
} from "../sanitize.js";
import type {
  CertificateMaterial,
  CompiledFile,
  HostGraph,
  IpListGraph,
  LocationGraph,
  NginxPaths,
  PoolGraph,
  RealmGraph,
} from "../types.js";
import { absolutePath, fileRefs, poolName, rateLimitZoneName, snippetPath } from "./files.js";
import { renderMaintenancePage } from "./maintenance.js";
import { configFile, textFile } from "./shared.js";

export interface HostRenderContext {
  caps: NginxCapabilities;
  paths: NginxPaths;
  pools: Map<number, PoolGraph>;
  ipLists: Map<number, IpListGraph>;
  realms: Map<number, RealmGraph>;
  certificates: Map<number, CertificateMaterial>;
}

/** Per-server rendering state (the same location renders differently on :80 and :443). */
interface ServerScope {
  host: HostGraph;
  ctx: HostRenderContext;
  tls: boolean;
  http3: boolean;
  /** External auth URL -> internal location path, shared by the server's locations. */
  authEndpoints: Map<string, string>;
}

const REDIRECT_CODES: Record<RedirectRule["statusCode"], number> = {
  MOVED_PERMANENTLY_301: 301,
  FOUND_302: 302,
  TEMPORARY_REDIRECT_307: 307,
  PERMANENT_REDIRECT_308: 308,
};

const SECURITY_PRESET: Array<[string, string]> = [
  ["X-Frame-Options", "SAMEORIGIN"],
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()"],
];
const DEFAULT_CSP = "frame-ancestors 'self'; upgrade-insecure-requests";
const ALT_SVC_VALUE = 'h3=":443"; ma=86400';
const RESERVED_PATH_PREFIX = "/__orla";

function hostLabel(host: HostGraph): string {
  return `"${host.name}" (#${host.id})`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Renders conf.d/host-{id}.conf plus the host's auxiliary files. */
export function renderHost(host: HostGraph, ctx: HostRenderContext): CompiledFile[] {
  if (host.domains.length === 0) {
    throw new ConfigValidationError(`O host ${hostLabel(host)} não tem nenhum domínio.`);
  }
  const serverNames = host.domains.map((domain) => sanitizeDomain(domain.domain));
  const tls = host.sslMode !== "OFF";
  const certificate = tls && host.certificateId !== null ? ctx.certificates.get(host.certificateId) : undefined;
  if (tls && !certificate) {
    throw new ConfigValidationError(
      `O host ${hostLabel(host)} está com SSL ativo, mas não tem um certificado válido associado.`,
    );
  }

  const files: CompiledFile[] = [];
  const nodes: ConfigNode[] = [];

  if (!tls || !host.forceHttps) {
    nodes.push(renderServer(host, ctx, serverNames, { tls: false, certificate: undefined }), blank());
  } else {
    nodes.push(renderHttpsRedirectServer(host, ctx, serverNames), blank());
  }
  if (tls && certificate) {
    nodes.push(renderServer(host, ctx, serverNames, { tls: true, certificate }), blank());
  }

  files.push(configFile(fileRefs.host(host.id), nodes, `Proxy host #${host.id}: ${host.name}`));

  if (host.maintenanceEnabled) {
    files.push(renderMaintenancePage(host));
  }
  if (host.sslMode === "FULL_STRICT" && host.originTrustedCaPem) {
    files.push(textFile(fileRefs.originCa(host.id), sanitizePem(host.originTrustedCaPem, "CA de origem")));
  }
  return files;
}

// ---------------------------------------------------------------------------
// Server blocks
// ---------------------------------------------------------------------------

function listenDirectives(ctx: HostRenderContext, tls: boolean, http3: boolean): ConfigNode[] {
  const port = tls ? 443 : 80;
  const extra = tls ? ["ssl"] : [];
  const nodes = [directive("listen", port, ...extra)];
  if (ctx.caps.ipv6) nodes.push(directive("listen", `[::]:${port}`, ...extra));
  if (http3) {
    nodes.push(directive("listen", 443, "quic"));
    if (ctx.caps.ipv6) nodes.push(directive("listen", "[::]:443", "quic"));
  }
  return nodes;
}

function renderHttpsRedirectServer(host: HostGraph, ctx: HostRenderContext, serverNames: string[]): ConfigNode {
  return block("server", [], [
    ...listenDirectives(ctx, false, false),
    directive("server_name", ...serverNames),
    directive("set", "$orla_host_id", host.id),
    blank(),
    directive("include", snippetPath(ctx.paths, "acme-challenge.conf")),
    blank(),
    comment("Force HTTPS"),
    block("location", ["/"], [directive("return", 301, trusted("https://$host$request_uri"))]),
  ]);
}

function renderServer(
  host: HostGraph,
  ctx: HostRenderContext,
  serverNames: string[],
  options: { tls: boolean; certificate: CertificateMaterial | undefined },
): ConfigNode {
  const http3 = options.tls && host.http3Enabled && ctx.caps.http3;
  const scope: ServerScope = { host, ctx, tls: options.tls, http3, authEndpoints: new Map() };
  const edge = host.edgeProtectionEnabled;
  const children: ConfigNode[] = [...listenDirectives(ctx, options.tls, http3)];

  children.push(directive("server_name", ...serverNames), directive("set", "$orla_host_id", host.id));

  if (options.tls && options.certificate) {
    children.push(
      blank(),
      comment(`TLS (${host.sslMode})`),
      directive("http2", host.http2Enabled ? "on" : "off"),
    );
    if (http3) children.push(directive("http3", "on"));
    children.push(
      directive("ssl_certificate", absolutePath(ctx.paths, fileRefs.certificateChain(options.certificate.id))),
      directive("ssl_certificate_key", absolutePath(ctx.paths, fileRefs.certificateKey(options.certificate.id))),
      directive("ssl_protocols", ...(host.minTlsVersion === "TLS_1_3" ? ["TLSv1.3"] : ["TLSv1.2", "TLSv1.3"])),
    );
  }

  children.push(
    blank(),
    comment("Performance"),
    directive("client_max_body_size", `${clampBodySize(host.clientMaxBodySizeMb)}m`),
    directive("gzip", host.gzipEnabled ? "on" : "off"),
  );
  if (ctx.caps.brotli && host.brotliEnabled) children.push(directive("brotli", "on"));
  children.push(
    directive("proxy_connect_timeout", `${clampTimeout(host.proxyConnectTimeoutSeconds)}s`),
    directive("proxy_send_timeout", `${clampTimeout(host.proxySendTimeoutSeconds)}s`),
    directive("proxy_read_timeout", `${clampTimeout(host.proxyReadTimeoutSeconds)}s`),
  );
  if (!host.proxyBufferingEnabled) children.push(directive("proxy_buffering", "off"));

  if (edge && host.blockBadBotsEnabled) {
    children.push(blank(), directive("include", snippetPath(ctx.paths, "block-bad-bots.conf")));
  }

  if (!options.tls) {
    children.push(blank(), directive("include", snippetPath(ctx.paths, "acme-challenge.conf")));
  }

  if (host.maintenanceEnabled) {
    children.push(blank(), ...renderMaintenance(host, ctx));
    return block("server", [], children);
  }

  const redirects = renderRedirects(host.redirectRules);
  if (redirects.length > 0) {
    children.push(blank(), comment("Redirect rules"), ...redirects);
  }

  const locations = renderLocations(scope);
  const authLocations = renderAuthEndpoints(scope);
  children.push(...authLocations, ...locations);

  if (host.customDirectives) {
    children.push(blank(), comment("Custom directives (admin)"), verbatim(sanitizeCustomDirectives(host.customDirectives)));
  }
  return block("server", [], children);
}

function clampBodySize(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 102400) {
    throw new ConfigValidationError(`Tamanho máximo de upload inválido: ${value} MB (máximo 102400).`);
  }
  return value;
}

function clampTimeout(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 86400) {
    throw new ConfigValidationError(`Timeout inválido: ${value}s (entre 1 e 86400).`);
  }
  return value;
}

function renderMaintenance(host: HostGraph, ctx: HostRenderContext): ConfigNode[] {
  const page = `${RESERVED_PATH_PREFIX}_maintenance.html`;
  return [
    comment("Maintenance mode"),
    directive("error_page", 503, page),
    block("location", ["=", page], [
      directive("internal"),
      directive("default_type", "text/html"),
      directive("alias", absolutePath(ctx.paths, fileRefs.maintenancePage(host.id))),
      directive("add_header", "Retry-After", 300, "always"),
      directive("add_header", "Cache-Control", quoted("no-store"), "always"),
    ]),
    block("location", ["/"], [directive("return", 503)]),
  ];
}

// ---------------------------------------------------------------------------
// Redirects (server level, evaluated before location matching)
// ---------------------------------------------------------------------------

function renderRedirects(rules: RedirectRule[]): ConfigNode[] {
  if (rules.length === 0) return [];
  const nodes: ConfigNode[] = [
    comment("Never redirect ACME HTTP-01 challenges"),
    block("if", ["($orla_is_acme)"], [directive("break")]),
  ];
  for (const rule of rules) {
    const { operator, regex, target } = buildRedirect(rule);
    nodes.push(
      comment(`Rule #${rule.id}: ${rule.name}`),
      block("if", ["($uri", operator, trusted(regex), ")"], [
        directive("return", REDIRECT_CODES[rule.statusCode], trusted(target)),
      ]),
    );
  }
  return nodes;
}

export function buildRedirect(rule: Pick<
  RedirectRule,
  "matchType" | "sourcePath" | "targetUrl" | "preservePath" | "preserveQuery"
>): { operator: string; regex: string; target: string } {
  const allowCaptures = rule.matchType === "WILDCARD" || rule.matchType.startsWith("REGEX");
  let target = sanitizeUrl(rule.targetUrl, { allowCaptures, field: "targetUrl" });
  let regex: string;
  let operator = "~";

  switch (rule.matchType) {
    case "EXACT":
      regex = `^${escapeRegex(sanitizePath(rule.sourcePath, "sourcePath"))}$`;
      break;
    case "PREFIX": {
      const base = sanitizePath(rule.sourcePath, "sourcePath").replace(/\/+$/, "");
      regex = `^${escapeRegex(base)}(/.*)?$`;
      if (rule.preservePath) target = `${target.replace(/\/+$/, "")}$1`;
      break;
    }
    case "WILDCARD":
      regex = wildcardToRegex(sanitizeWildcardPath(rule.sourcePath, "sourcePath"));
      break;
    case "REGEX":
      regex = sanitizeRegex(rule.sourcePath, "sourcePath");
      break;
    case "REGEX_CASE_INSENSITIVE":
      regex = sanitizeRegex(rule.sourcePath, "sourcePath");
      operator = "~*";
      break;
  }

  if (rule.preserveQuery) {
    if (target.includes("?")) {
      throw new ConfigValidationError(
        "Para preservar a query string, a URL de destino não pode ter query própria.",
        "preserveQuery",
      );
    }
    target = `${target}$is_args$args`;
  }
  return { operator, regex, target };
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

function locationHeader(matchType: PathMatchType, path: string): { args: Token[]; key: string } {
  switch (matchType) {
    case "EXACT": {
      const value = sanitizePath(path);
      return { args: ["=", value], key: `= ${value}` };
    }
    case "PREFIX": {
      const value = sanitizePath(path);
      return { args: [value], key: value };
    }
    case "WILDCARD": {
      const regex = wildcardToRegex(sanitizeWildcardPath(path));
      return { args: ["~", trusted(regex)], key: `~ ${regex}` };
    }
    case "REGEX": {
      const regex = sanitizeRegex(path);
      return { args: ["~", trusted(regex)], key: `~ ${regex}` };
    }
    case "REGEX_CASE_INSENSITIVE": {
      const regex = sanitizeRegex(path);
      return { args: ["~*", trusted(regex)], key: `~* ${regex}` };
    }
  }
}

function renderLocations(scope: ServerScope): ConfigNode[] {
  const { host } = scope;
  const nodes: ConfigNode[] = [];
  const seen = new Set<string>();
  let hasRoot = false;

  for (const location of host.locations) {
    if (location.path.startsWith(RESERVED_PATH_PREFIX)) {
      throw new ConfigValidationError(`Caminhos iniciados por ${RESERVED_PATH_PREFIX} são reservados pelo Orla.`);
    }
    const header = locationHeader(location.matchType, location.path);
    if (seen.has(header.key)) {
      throw new ConfigValidationError(`O host ${hostLabel(host)} tem duas rotas iguais: ${header.key}`);
    }
    seen.add(header.key);
    if (header.key === "/") hasRoot = true;
    nodes.push(blank(), comment(`Location #${location.id}`), renderLocation(scope, header.args, location));
  }

  if (!hasRoot) {
    nodes.push(blank(), comment("Default route"), renderLocation(scope, ["/"], null));
  }
  return nodes;
}

function renderLocation(scope: ServerScope, header: Token[], location: LocationGraph | null): ConfigNode {
  const { host, ctx } = scope;
  const edge = host.edgeProtectionEnabled;
  const children: ConfigNode[] = [];

  children.push(...renderAccessLists(scope, location));
  children.push(...renderAuth(scope, location));

  if (edge) {
    children.push(directive("include", snippetPath(ctx.paths, "edge-protection.conf")));
    const rules = [
      ...host.rateLimitRules.filter((rule) => rule.locationId === null),
      ...(location?.rateLimitRules ?? []),
    ];
    children.push(...rules.map(renderLimitReq));
  }

  const poolId = location ? (location.upstreamPoolId ?? host.upstreamPoolId) : host.upstreamPoolId;
  if (poolId === null) {
    children.push(comment("No upstream configured for this route"), directive("return", 404));
    return block("location", header, children);
  }
  const pool = ctx.pools.get(poolId);
  if (!pool) {
    throw new ConfigValidationError(`O host ${hostLabel(host)} referencia um pool de upstream inexistente (#${poolId}).`);
  }

  const websocket = location?.websocketEnabled ?? host.websocketEnabled;
  children.push(...renderRequestHeaders(host.headerRules, location?.headerRules ?? [], websocket));
  if (websocket) {
    children.push(directive("proxy_read_timeout", "3600s"), directive("proxy_send_timeout", "3600s"));
  }
  if (location?.clientMaxBodySizeMb !== null && location?.clientMaxBodySizeMb !== undefined) {
    children.push(directive("client_max_body_size", `${clampBodySize(location.clientMaxBodySizeMb)}m`));
  }

  const cache = edge && (location?.cacheEnabled ?? host.cacheEnabled);
  if (cache) children.push(...renderCache(host));
  children.push(...renderResponseHeaders(scope, location, cache));

  const scheme = originScheme(host.sslMode, pool.scheme);
  if (scheme === "https") children.push(...renderOriginTls(host, ctx));
  children.push(directive("proxy_pass", proxyPassTarget(scheme, pool.id, location)));

  if (location?.customDirectives) {
    children.push(comment("Custom directives (admin)"), verbatim(sanitizeCustomDirectives(location.customDirectives)));
  }
  return block("location", header, children);
}

function proxyPassTarget(scheme: "http" | "https", poolId: number, location: LocationGraph | null): string {
  const base = `${scheme}://${poolName(poolId)}`;
  if (!location?.rewritePath) return base;
  if (location.matchType !== "PREFIX" && location.matchType !== "EXACT") {
    throw new ConfigValidationError(
      "Reescrita de caminho só é permitida em rotas exatas ou por prefixo.",
      "rewritePath",
    );
  }
  return `${base}${sanitizePath(location.rewritePath, "rewritePath")}`;
}

/**
 * Origin protocol per SSL mode (Cloudflare semantics): Flexible always talks
 * HTTP to the origin, Full / Full (Strict) always HTTPS, Off follows the pool.
 */
export function originScheme(sslMode: HostGraph["sslMode"], poolScheme: PoolGraph["scheme"]): "http" | "https" {
  if (sslMode === "FLEXIBLE") return "http";
  if (sslMode === "FULL" || sslMode === "FULL_STRICT") return "https";
  return poolScheme === "HTTPS" ? "https" : "http";
}

function renderOriginTls(host: HostGraph, ctx: HostRenderContext): ConfigNode[] {
  const nodes: ConfigNode[] = [
    directive("proxy_ssl_server_name", "on"),
    directive("proxy_ssl_name", host.originServerName ? sanitizeDomain(host.originServerName, "originServerName") : "$host"),
    directive("proxy_ssl_protocols", "TLSv1.2", "TLSv1.3"),
    directive("proxy_ssl_session_reuse", "on"),
  ];
  if (host.sslMode === "FULL_STRICT") {
    const trustStore = host.originTrustedCaPem
      ? absolutePath(ctx.paths, fileRefs.originCa(host.id))
      : ctx.paths.systemCaBundle;
    nodes.push(
      directive("proxy_ssl_verify", "on"),
      directive("proxy_ssl_verify_depth", 3),
      directive("proxy_ssl_trusted_certificate", trustStore),
    );
  } else {
    nodes.push(directive("proxy_ssl_verify", "off"));
  }
  return nodes;
}

function renderLimitReq(rule: RateLimitRule): ConfigNode {
  const args: Token[] = [`zone=${rateLimitZoneName(rule.id)}`];
  if (rule.burst > 0) args.push(`burst=${rule.burst}`);
  if (rule.nodelay) args.push("nodelay");
  return directive("limit_req", ...args);
}

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

function renderAccessLists(scope: ServerScope, location: LocationGraph | null): ConfigNode[] {
  const ids = [...scope.host.ipLists, ...(location?.ipLists ?? [])].map((link) => link.ipListId);
  const lists = [...new Set(ids)].map((id) => {
    const list = scope.ctx.ipLists.get(id);
    if (!list) throw new ConfigValidationError(`Lista de IPs #${id} não encontrada.`);
    return list;
  });
  if (lists.length === 0) return [];

  const blocklists = lists.filter((list) => list.type === "BLOCKLIST");
  const allowlists = lists.filter((list) => list.type === "ALLOWLIST");
  const nodes = [...blocklists, ...allowlists].map((list) =>
    directive("include", absolutePath(scope.ctx.paths, fileRefs.ipList(list.id))),
  );
  if (allowlists.length > 0) nodes.push(directive("deny", "all"));
  return nodes;
}

interface EffectiveAuth {
  mode: AuthMode;
  realmId: number | null;
  externalUrl: string | null;
}

function effectiveAuth(host: HostGraph, location: LocationGraph | null): EffectiveAuth {
  if (location && location.authMode !== null) {
    return { mode: location.authMode, realmId: location.basicAuthRealmId, externalUrl: location.externalAuthUrl };
  }
  return { mode: host.authMode, realmId: host.basicAuthRealmId, externalUrl: host.externalAuthUrl };
}

function renderAuth(scope: ServerScope, location: LocationGraph | null): ConfigNode[] {
  const auth = effectiveAuth(scope.host, location);
  if (auth.mode === "BASIC") {
    const realm = auth.realmId !== null ? scope.ctx.realms.get(auth.realmId) : undefined;
    if (!realm) {
      throw new ConfigValidationError(`O host ${hostLabel(scope.host)} usa Basic Auth sem um grupo de usuários válido.`);
    }
    return [
      directive("auth_basic", quoted(sanitizeQuotedText(realm.realm, "Nome do realm", 128))),
      directive("auth_basic_user_file", absolutePath(scope.ctx.paths, fileRefs.htpasswd(realm.id))),
    ];
  }
  if (auth.mode === "EXTERNAL") {
    if (!auth.externalUrl) {
      throw new ConfigValidationError(`O host ${hostLabel(scope.host)} usa autenticação externa sem URL.`);
    }
    const url = sanitizeUrl(auth.externalUrl, { field: "externalAuthUrl" });
    let endpoint = scope.authEndpoints.get(url);
    if (!endpoint) {
      endpoint = `${RESERVED_PATH_PREFIX}_auth_${scope.authEndpoints.size}`;
      scope.authEndpoints.set(url, endpoint);
    }
    return [directive("auth_request", endpoint)];
  }
  return [];
}

/** Internal subrequest locations for auth_request, one per distinct URL. */
function renderAuthEndpoints(scope: ServerScope): ConfigNode[] {
  const nodes: ConfigNode[] = [];
  for (const [url, endpoint] of scope.authEndpoints) {
    nodes.push(
      blank(),
      comment("External authentication (auth_request)"),
      block("location", ["=", endpoint], [
        directive("internal"),
        directive("proxy_pass", quoted(url)),
        directive("proxy_pass_request_body", "off"),
        directive("proxy_set_header", "Content-Length", quoted("")),
        directive("proxy_set_header", "X-Original-URI", "$request_uri"),
        directive("proxy_set_header", "X-Original-Method", "$request_method"),
        directive("proxy_set_header", "X-Original-Host", "$host"),
        directive("proxy_set_header", "X-Forwarded-For", "$proxy_add_x_forwarded_for"),
        directive("proxy_set_header", "X-Forwarded-Proto", "$scheme"),
      ]),
    );
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

const BASE_REQUEST_HEADERS: Array<[string, string]> = [
  ["Host", "$host"],
  ["X-Real-IP", "$remote_addr"],
  ["X-Forwarded-For", "$proxy_add_x_forwarded_for"],
  ["X-Forwarded-Proto", "$scheme"],
  ["X-Forwarded-Host", "$host"],
  ["X-Forwarded-Port", "$server_port"],
  ["X-Request-ID", "$request_id"],
  ["Connection", "$orla_upstream_connection"],
];

/** Lowest priority first, so higher-priority rules (and location rules) win. */
function ascending(rules: HeaderRule[]): HeaderRule[] {
  return [...rules].sort((a, b) => a.priority - b.priority || b.id - a.id);
}

function renderRequestHeaders(hostRules: HeaderRule[], locationRules: HeaderRule[], websocket: boolean): ConfigNode[] {
  const headers = new Map<string, { name: string; value: Token }>();
  for (const [name, value] of BASE_REQUEST_HEADERS) headers.set(name.toLowerCase(), { name, value });
  if (websocket) headers.set("upgrade", { name: "Upgrade", value: "$http_upgrade" });

  for (const rule of [...ascending(hostRules), ...ascending(locationRules)]) {
    if (rule.phase !== "REQUEST") continue;
    const name = sanitizeHeaderName(rule.headerName, "REQUEST");
    const value = rule.operation === "REMOVE" ? "" : sanitizeHeaderValue(rule.headerValue ?? "");
    headers.set(name.toLowerCase(), { name, value: quoted(value) });
  }
  return [...headers.values()].map(({ name, value }) => directive("proxy_set_header", name, value));
}

type HeaderValue = { kind: "text"; text: string } | { kind: "variable"; text: string } | { kind: "alt-svc" };

interface ResponseHeaderOp {
  name: string;
  operation: "SET" | "ADD" | "REMOVE";
  value: HeaderValue;
  always: boolean;
}

function renderResponseHeaders(scope: ServerScope, location: LocationGraph | null, cache: boolean): ConfigNode[] {
  const { host } = scope;
  const ops = new Map<string, ResponseHeaderOp>();
  const set = (op: ResponseHeaderOp) => ops.set(op.name.toLowerCase(), op);

  if (scope.tls && host.hstsEnabled) {
    let value = `max-age=${Math.max(0, Math.trunc(host.hstsMaxAge))}`;
    if (host.hstsIncludeSubdomains) value += "; includeSubDomains";
    if (host.hstsPreload) value += "; preload";
    set({ name: "Strict-Transport-Security", operation: "SET", value: { kind: "text", text: value }, always: true });
  }
  if (scope.http3) {
    set({ name: "Alt-Svc", operation: "SET", value: { kind: "alt-svc" }, always: true });
  }
  if (host.edgeProtectionEnabled && host.securityHeadersEnabled) {
    for (const [name, text] of SECURITY_PRESET) {
      set({ name, operation: "SET", value: { kind: "text", text }, always: true });
    }
    const csp = host.contentSecurityPolicy?.trim() || DEFAULT_CSP;
    set({
      name: "Content-Security-Policy",
      operation: "SET",
      value: { kind: "text", text: sanitizeHeaderValue(csp, "contentSecurityPolicy") },
      always: true,
    });
  }
  if (cache) {
    set({
      name: "X-Cache-Status",
      operation: "SET",
      value: { kind: "variable", text: "$upstream_cache_status" },
      always: true,
    });
  }
  for (const rule of [...ascending(host.headerRules), ...ascending(location?.headerRules ?? [])]) {
    if (rule.phase !== "RESPONSE") continue;
    const name = sanitizeHeaderName(rule.headerName, "RESPONSE");
    set({
      name,
      operation: rule.operation,
      value: { kind: "text", text: rule.operation === "REMOVE" ? "" : sanitizeHeaderValue(rule.headerValue ?? "") },
      always: rule.always,
    });
  }

  const headersMore = scope.ctx.caps.headersMore;
  const nodes: ConfigNode[] = [];
  for (const op of ops.values()) {
    if (op.operation === "REMOVE") {
      nodes.push(directive("proxy_hide_header", op.name));
      if (headersMore) nodes.push(directive("more_clear_headers", op.name));
      continue;
    }
    if (op.operation === "SET" && headersMore) {
      nodes.push(directive("more_set_headers", headerLine(op.name, op.value)));
      continue;
    }
    if (op.operation === "SET") nodes.push(directive("proxy_hide_header", op.name));
    const args: Token[] = [op.name, headerToken(op.value)];
    if (op.always) args.push("always");
    nodes.push(directive("add_header", ...args));
  }
  return nodes;
}

function headerToken(value: HeaderValue): Token {
  if (value.kind === "alt-svc") return constant(`'${ALT_SVC_VALUE}'`);
  if (value.kind === "variable") return value.text;
  return quoted(value.text);
}

function headerLine(name: string, value: HeaderValue): Token {
  if (value.kind === "alt-svc") return constant(`'${name}: ${ALT_SVC_VALUE}'`);
  if (value.kind === "variable") return trusted(`${name}: ${value.text}`);
  return quoted(`${name}: ${value.text}`);
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

function renderCache(host: HostGraph): ConfigNode[] {
  const ttl = host.cacheDefaultTtlSeconds;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 31536000) {
    throw new ConfigValidationError(`TTL de cache inválido: ${ttl}s.`);
  }
  const staticOnly = host.cacheMode === "STATIC_ONLY";
  const bypass = ["$orla_cache_bypass_client", "$orla_cache_bypass_auth", ...(staticOnly ? ["$orla_is_dynamic"] : [])];
  const noCache = ["$orla_cache_bypass_auth", ...(staticOnly ? ["$orla_is_dynamic"] : [])];

  const nodes: ConfigNode[] = [
    directive("proxy_cache", "orla_cache"),
    // The "orla<id>|" prefix lets the purge helper find this host's entries.
    directive("proxy_cache_key", trusted("orla$orla_host_id|$scheme|$host|$request_uri")),
    directive("proxy_cache_valid", 200, 203, 301, 302, `${ttl}s`),
    directive("proxy_cache_valid", 404, "60s"),
    directive("proxy_cache_bypass", ...bypass),
    directive("proxy_no_cache", ...noCache),
  ];
  if (!host.cacheRespectOriginHeaders) {
    nodes.push(directive("proxy_ignore_headers", "Cache-Control", "Expires"));
  }
  if (host.cacheServeStaleOnError) {
    nodes.push(directive("proxy_cache_use_stale", "error", "timeout", "updating", "http_500", "http_502", "http_503", "http_504"));
  }
  return nodes;
}
