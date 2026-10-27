import type { NginxCapabilities } from "../capabilities.js";
import type { CompileOptions } from "../compiler.js";
import type { CertificateMaterial, ConfigSnapshot, HostGraph, LocationGraph, PoolGraph } from "../types.js";

const now = new Date("2026-01-01T00:00:00Z");

export const allCaps: NginxCapabilities = {
  nginxVersion: "1.26.3",
  http3: true,
  ipv6: true,
  brotli: true,
  headersMore: true,
};

export function options(caps: Partial<NginxCapabilities> = {}, root = "/etc/nginx"): CompileOptions {
  return {
    caps: { ...allCaps, ...caps },
    paths: {
      hostsDir: `${root}/conf.d`,
      generatedDir: `${root}/orla/generated`,
      snippetsDir: `${root}/orla/snippets`,
      acmeWebroot: "/var/lib/orla/acme",
      systemCaBundle: "/etc/ssl/certs/ca-certificates.crt",
    },
  };
}

export function pool(overrides: Partial<PoolGraph> = {}): PoolGraph {
  return {
    id: 1,
    name: "app",
    description: null,
    scheme: "HTTP",
    algorithm: "ROUND_ROBIN",
    keepaliveConnections: 32,
    createdAt: now,
    updatedAt: now,
    servers: [
      {
        id: 1,
        poolId: overrides.id ?? 1,
        address: "127.0.0.1",
        port: 8080,
        weight: 1,
        maxFails: 3,
        failTimeoutSeconds: 10,
        isBackup: false,
        isDown: false,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
    ...overrides,
  };
}

export function location(overrides: Partial<LocationGraph> = {}): LocationGraph {
  return {
    id: 1,
    hostId: 1,
    path: "/api/",
    matchType: "PREFIX",
    upstreamPoolId: null,
    rewritePath: null,
    priority: 0,
    enabled: true,
    websocketEnabled: null,
    cacheEnabled: null,
    clientMaxBodySizeMb: null,
    authMode: null,
    basicAuthRealmId: null,
    externalAuthUrl: null,
    customDirectives: null,
    createdAt: now,
    updatedAt: now,
    upstreamPool: null,
    headerRules: [],
    rateLimitRules: [],
    ipLists: [],
    ...overrides,
  };
}

export function host(overrides: Partial<HostGraph> = {}): HostGraph {
  const id = overrides.id ?? 1;
  return {
    id,
    name: "Exemplo",
    description: null,
    enabled: true,
    edgeProtectionEnabled: true,
    maintenanceEnabled: false,
    maintenanceTitle: null,
    maintenanceMessage: null,
    maintenanceHtml: null,
    upstreamPoolId: 1,
    websocketEnabled: false,
    http2Enabled: true,
    http3Enabled: false,
    sslMode: "OFF",
    certificateId: null,
    forceHttps: false,
    hstsEnabled: false,
    hstsMaxAge: 31536000,
    hstsIncludeSubdomains: false,
    hstsPreload: false,
    minTlsVersion: "TLS_1_2",
    originServerName: null,
    originTrustedCaPem: null,
    cacheEnabled: false,
    cacheMode: "STATIC_ONLY",
    cacheDefaultTtlSeconds: 3600,
    cacheRespectOriginHeaders: true,
    cacheServeStaleOnError: true,
    cacheLastPurgedAt: null,
    gzipEnabled: true,
    brotliEnabled: false,
    clientMaxBodySizeMb: 10,
    proxyConnectTimeoutSeconds: 60,
    proxyReadTimeoutSeconds: 60,
    proxySendTimeoutSeconds: 60,
    proxyBufferingEnabled: true,
    securityHeadersEnabled: false,
    contentSecurityPolicy: null,
    blockBadBotsEnabled: false,
    authMode: "NONE",
    basicAuthRealmId: null,
    externalAuthUrl: null,
    customDirectives: null,
    createdAt: now,
    updatedAt: now,
    domains: [{ id: id * 10, hostId: id, domain: `site${id}.example.com`, isPrimary: true, createdAt: now }],
    locations: [],
    redirectRules: [],
    headerRules: [],
    rateLimitRules: [],
    ipLists: [],
    ...overrides,
  };
}

export function snapshot(overrides: Partial<ConfigSnapshot> = {}): ConfigSnapshot {
  return {
    hosts: [host()],
    pools: [pool()],
    ipLists: [],
    realms: [],
    certificates: [],
    ...overrides,
  };
}

export function certificate(id: number, certificatePem: string, privateKeyPem: string): CertificateMaterial {
  return { id, certificatePem, chainPem: null, privateKeyPem };
}
