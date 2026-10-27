/* Response shapes of the Orla API (see server/src/modules). */

export type SslMode = "OFF" | "FLEXIBLE" | "FULL" | "FULL_STRICT";
export type TlsVersion = "TLS_1_2" | "TLS_1_3";
export type CacheMode = "STATIC_ONLY" | "ALL";
export type AuthMode = "NONE" | "BASIC" | "EXTERNAL";
export type UpstreamScheme = "HTTP" | "HTTPS";
export type LoadBalancingAlgorithm = "ROUND_ROBIN" | "LEAST_CONN" | "IP_HASH";
export type CertificateStatus = "PENDING" | "VALID" | "EXPIRED" | "ERROR" | "REVOKED";
export type AnalyticsRange = "1h" | "24h" | "7d" | "30d";

export interface HostDomain {
  id: number;
  hostId: number;
  domain: string;
  isPrimary: boolean;
}

export interface UpstreamServer {
  id: number;
  poolId: number;
  address: string;
  port: number;
  weight: number;
  maxFails: number;
  failTimeoutSeconds: number;
  isBackup: boolean;
  isDown: boolean;
  sortOrder: number;
}

export interface UpstreamPool {
  id: number;
  name: string;
  description: string | null;
  scheme: UpstreamScheme;
  algorithm: LoadBalancingAlgorithm;
  keepaliveConnections: number;
  createdAt: string;
  updatedAt: string;
  servers: UpstreamServer[];
  _count: { hosts: number; locations: number };
}

export interface HostFlags {
  enabled: boolean;
  edgeProtectionEnabled: boolean;
  maintenanceEnabled: boolean;
  websocketEnabled: boolean;
  http2Enabled: boolean;
  http3Enabled: boolean;
  cacheEnabled: boolean;
  forceHttps: boolean;
}

export interface HostBase extends HostFlags {
  id: number;
  name: string;
  description: string | null;
  maintenanceTitle: string | null;
  maintenanceMessage: string | null;
  maintenanceHtml: string | null;
  upstreamPoolId: number | null;
  sslMode: SslMode;
  certificateId: number | null;
  hstsEnabled: boolean;
  hstsMaxAge: number;
  hstsIncludeSubdomains: boolean;
  hstsPreload: boolean;
  minTlsVersion: TlsVersion;
  originServerName: string | null;
  originTrustedCaPem: string | null;
  cacheMode: CacheMode;
  cacheDefaultTtlSeconds: number;
  cacheRespectOriginHeaders: boolean;
  cacheServeStaleOnError: boolean;
  cacheLastPurgedAt: string | null;
  gzipEnabled: boolean;
  brotliEnabled: boolean;
  clientMaxBodySizeMb: number;
  proxyConnectTimeoutSeconds: number;
  proxyReadTimeoutSeconds: number;
  proxySendTimeoutSeconds: number;
  proxyBufferingEnabled: boolean;
  securityHeadersEnabled: boolean;
  contentSecurityPolicy: string | null;
  blockBadBotsEnabled: boolean;
  authMode: AuthMode;
  basicAuthRealmId: number | null;
  externalAuthUrl: string | null;
  customDirectives: string | null;
  createdAt: string;
  updatedAt: string;
  domains: HostDomain[];
}

export interface HostListItem extends HostBase {
  upstreamPool: { id: number; name: string; scheme: UpstreamScheme; _count: { servers: number } } | null;
  certificate: { id: number; name: string; status: CertificateStatus; notAfter: string | null } | null;
  _count: { locations: number; redirectRules: number; headerRules: number; rateLimitRules: number };
}

export interface HostDetail extends HostBase {
  upstreamPool: UpstreamPool | null;
  certificate: {
    id: number;
    name: string;
    type: "ACME" | "CUSTOM";
    status: CertificateStatus;
    notAfter: string | null;
    domains: Array<{ domain: string }>;
  } | null;
  basicAuthRealm: { id: number; name: string } | null;
  locations: Array<{ id: number; path: string; enabled: boolean }>;
  redirectRules: Array<{ id: number; name: string; enabled: boolean }>;
  headerRules: Array<{ id: number; headerName: string; enabled: boolean }>;
  rateLimitRules: Array<{ id: number; name: string; enabled: boolean }>;
  ipLists: Array<{ ipListId: number; ipList: { id: number; name: string; type: "ALLOWLIST" | "BLOCKLIST" } }>;
}

export interface CertificateSummary {
  id: number;
  name: string;
  type: "ACME" | "CUSTOM";
  status: CertificateStatus;
  notAfter: string | null;
  domains: Array<{ domain: string }>;
}

export interface AnalyticsSummary {
  range: AnalyticsRange;
  since: string;
  requests: number;
  bytesSent: number;
  bytesReceived: number;
  status: Record<"1xx" | "2xx" | "3xx" | "4xx" | "5xx", number>;
  cache: { HIT: number; MISS: number; BYPASS: number; EXPIRED: number; OTHER: number; hitRatio: number | null };
  avgRequestTimeMs: number | null;
  avgUpstreamTimeMs: number | null;
  hosts: Array<{ hostId: number; requests: number; bytesSent: number; status5xx: number }>;
}

export interface TimeseriesPoint {
  bucket: string;
  requests: number;
  bytesSent: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  cacheHit: number;
  cacheMiss: number;
}

export interface AnalyticsTimeseries {
  range: AnalyticsRange;
  interval: string;
  points: TimeseriesPoint[];
}

export interface AnalyticsTop {
  kind: "IP" | "PATH";
  items: Array<{ value: string; requests: number; bytesSent: number }>;
}

export interface Capabilities {
  nginxVersion: string;
  http3: boolean;
  ipv6: boolean;
  brotli: boolean;
  headersMore: boolean;
}

export interface Deployment {
  id: number;
  status: "RUNNING" | "SUCCESS" | "FAILED" | "ROLLED_BACK";
  trigger: "USER" | "BOOT" | "CERTIFICATE_RENEWAL" | "SYSTEM";
  triggeredById: number | null;
  summary: string;
  errorMessage: string | null;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface SystemInfo {
  version: string;
  node: string;
  capabilities: Capabilities;
  counts: { hosts: number; certificates: number; upstreamPools: number };
  lastDeployment: Deployment | null;
}
