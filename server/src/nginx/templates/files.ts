import path from "node:path";
import type { FileRoot, NginxPaths } from "../types.js";

/** Where every generated artifact lives, relative to its root. */
export interface FileRef {
  root: FileRoot;
  path: string;
}

export const fileRefs = {
  host: (hostId: number): FileRef => ({ root: "hosts", path: `host-${hostId}.conf` }),
  upstreams: (): FileRef => ({ root: "generated", path: "http.d/upstreams.conf" }),
  rateLimits: (): FileRef => ({ root: "generated", path: "http.d/rate-limits.conf" }),
  ipList: (listId: number): FileRef => ({ root: "generated", path: `ip-lists/list-${listId}.conf` }),
  htpasswd: (realmId: number): FileRef => ({ root: "generated", path: `htpasswd/realm-${realmId}` }),
  maintenancePage: (hostId: number): FileRef => ({ root: "generated", path: `www/maintenance-${hostId}.html` }),
  certificateChain: (certificateId: number): FileRef => ({
    root: "generated",
    path: `certs/${certificateId}/fullchain.pem`,
  }),
  certificateKey: (certificateId: number): FileRef => ({
    root: "generated",
    path: `certs/${certificateId}/privkey.pem`,
  }),
  originCa: (hostId: number): FileRef => ({ root: "generated", path: `certs/origin-ca-host-${hostId}.pem` }),
};

export function absolutePath(paths: NginxPaths, ref: FileRef): string {
  const base = ref.root === "hosts" ? paths.hostsDir : paths.generatedDir;
  return path.posix.join(base, ref.path);
}

export function snippetPath(paths: NginxPaths, name: string): string {
  return path.posix.join(paths.snippetsDir, name);
}

/** File modes: private keys are owner-only, the rest is group-readable (www-data is in group orla). */
export const FILE_MODE = 0o640;
export const PRIVATE_KEY_MODE = 0o600;

export const poolName = (poolId: number): string => `orla_pool_${poolId}`;
export const rateLimitZoneName = (ruleId: number): string => `orla_rl_${ruleId}`;
