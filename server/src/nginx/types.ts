import type { Prisma } from "@prisma/client";

/*
 * Shapes the compiler consumes. They are Prisma payload types so the loader
 * can fetch them in one go, but the compiler itself never touches the
 * database: it is a pure function of a ConfigSnapshot.
 */

export const locationInclude = {
  upstreamPool: true,
  headerRules: { where: { enabled: true }, orderBy: [{ priority: "desc" }, { id: "asc" }] },
  rateLimitRules: { where: { enabled: true }, orderBy: { id: "asc" } },
  ipLists: { orderBy: [{ priority: "asc" }, { ipListId: "asc" }] },
} satisfies Prisma.LocationInclude;

export const hostInclude = {
  domains: { orderBy: [{ isPrimary: "desc" }, { domain: "asc" }] },
  locations: {
    where: { enabled: true },
    orderBy: [{ priority: "desc" }, { id: "asc" }],
    include: locationInclude,
  },
  redirectRules: { where: { enabled: true }, orderBy: [{ priority: "desc" }, { id: "asc" }] },
  headerRules: { where: { enabled: true, locationId: null }, orderBy: [{ priority: "desc" }, { id: "asc" }] },
  rateLimitRules: { where: { enabled: true }, orderBy: { id: "asc" } },
  ipLists: { orderBy: [{ priority: "asc" }, { ipListId: "asc" }] },
} satisfies Prisma.ProxyHostInclude;

export const poolInclude = {
  servers: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
} satisfies Prisma.UpstreamPoolInclude;

export const ipListInclude = {
  entries: { orderBy: { id: "asc" } },
} satisfies Prisma.IpListInclude;

export const realmInclude = {
  users: { orderBy: { username: "asc" } },
} satisfies Prisma.BasicAuthRealmInclude;

export type HostGraph = Prisma.ProxyHostGetPayload<{ include: typeof hostInclude }>;
export type LocationGraph = HostGraph["locations"][number];
export type PoolGraph = Prisma.UpstreamPoolGetPayload<{ include: typeof poolInclude }>;
export type IpListGraph = Prisma.IpListGetPayload<{ include: typeof ipListInclude }>;
export type RealmGraph = Prisma.BasicAuthRealmGetPayload<{ include: typeof realmInclude }>;

/** Decrypted key material of a certificate ready to be written to disk. */
export interface CertificateMaterial {
  id: number;
  certificatePem: string;
  chainPem: string | null;
  privateKeyPem: string;
}

export interface ConfigSnapshot {
  hosts: HostGraph[];
  pools: PoolGraph[];
  ipLists: IpListGraph[];
  realms: RealmGraph[];
  certificates: CertificateMaterial[];
}

/** Absolute locations used inside generated files. */
export interface NginxPaths {
  hostsDir: string;
  generatedDir: string;
  snippetsDir: string;
  acmeWebroot: string;
  systemCaBundle: string;
}

export type FileRoot = "hosts" | "generated";

export interface CompiledFile {
  root: FileRoot;
  /** Path relative to the root, with "/" separators. */
  path: string;
  content: string;
  mode: number;
}
