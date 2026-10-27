import type { NginxCapabilities } from "./capabilities.js";
import { ConfigValidationError } from "./errors.js";
import { renderCertificate, renderHtpasswd, renderIpList, renderRateLimitZones, renderUpstreams } from "./templates/global.js";
import { renderHost, type HostRenderContext } from "./templates/host.js";
import { fileRefs } from "./templates/files.js";
import { sanitizeDomain } from "./sanitize.js";
import type { CompiledFile, ConfigSnapshot, HostGraph, NginxPaths, PoolGraph } from "./types.js";

export interface CompileOptions {
  caps: NginxCapabilities;
  paths: NginxPaths;
}

function buildContext(snapshot: ConfigSnapshot, options: CompileOptions): HostRenderContext {
  return {
    caps: options.caps,
    paths: options.paths,
    pools: new Map(snapshot.pools.map((pool) => [pool.id, pool])),
    ipLists: new Map(snapshot.ipLists.map((list) => [list.id, list])),
    realms: new Map(snapshot.realms.map((realm) => [realm.id, realm])),
    certificates: new Map(snapshot.certificates.map((material) => [material.id, material])),
  };
}

function referencedPools(hosts: HostGraph[], pools: PoolGraph[]): PoolGraph[] {
  const ids = new Set<number>();
  for (const host of hosts) {
    if (host.maintenanceEnabled) continue;
    if (host.upstreamPoolId !== null) ids.add(host.upstreamPoolId);
    for (const location of host.locations) {
      if (location.upstreamPoolId !== null) ids.add(location.upstreamPoolId);
    }
  }
  return pools.filter((pool) => ids.has(pool.id)).sort((a, b) => a.id - b.id);
}

function assertUniqueServerNames(hosts: HostGraph[]): void {
  const owners = new Map<string, HostGraph>();
  for (const host of hosts) {
    for (const domain of host.domains) {
      const name = sanitizeDomain(domain.domain);
      const owner = owners.get(name);
      if (owner) {
        throw new ConfigValidationError(
          `O domínio ${name} está em dois hosts ativos: "${owner.name}" e "${host.name}".`,
        );
      }
      owners.set(name, host);
    }
  }
}

/**
 * Compiles the whole managed configuration from a database snapshot.
 * Deterministic: the same snapshot always yields byte-identical files in
 * the same order.
 */
export function compileConfig(snapshot: ConfigSnapshot, options: CompileOptions): CompiledFile[] {
  const ctx = buildContext(snapshot, options);
  const hosts = snapshot.hosts.filter((host) => host.enabled).sort((a, b) => a.id - b.id);
  assertUniqueServerNames(hosts);

  const files: CompiledFile[] = [
    renderUpstreams(referencedPools(hosts, snapshot.pools)),
    renderRateLimitZones(hosts),
  ];
  for (const list of [...snapshot.ipLists].sort((a, b) => a.id - b.id)) files.push(renderIpList(list));
  for (const realm of [...snapshot.realms].sort((a, b) => a.id - b.id)) files.push(renderHtpasswd(realm));
  for (const material of [...snapshot.certificates].sort((a, b) => a.id - b.id)) {
    files.push(...renderCertificate(material));
  }
  for (const host of hosts) files.push(...renderHost(host, ctx));

  return files.sort((a, b) => (a.root === b.root ? a.path.localeCompare(b.path) : a.root.localeCompare(b.root)));
}

/**
 * Renders the host file for the "Visualizar .conf" preview. `host` may be an
 * unsaved draft; the rest of the snapshot provides pools, lists and certs.
 */
export function previewHostConfig(host: HostGraph, snapshot: ConfigSnapshot, options: CompileOptions): string {
  const ctx = buildContext(snapshot, options);
  const hostRef = fileRefs.host(host.id);
  const file = renderHost(host, ctx).find((candidate) => candidate.root === hostRef.root && candidate.path === hostRef.path);
  if (!file) {
    throw new ConfigValidationError("Não foi possível gerar a configuração do host.");
  }
  return file.content;
}
