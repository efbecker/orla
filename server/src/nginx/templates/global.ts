import { blank, block, comment, directive, type ConfigNode } from "../builder.js";
import { ConfigValidationError } from "../errors.js";
import {
  formatUpstreamAddress,
  sanitizeBasicAuthUsername,
  sanitizeIpOrCidr,
  sanitizePasswordHash,
  sanitizePem,
  sanitizePort,
  sanitizeUpstreamAddress,
} from "../sanitize.js";
import type { CertificateMaterial, CompiledFile, HostGraph, IpListGraph, PoolGraph, RealmGraph } from "../types.js";
import { fileRefs, poolName, PRIVATE_KEY_MODE, rateLimitZoneName } from "./files.js";
import { configFile, textFile } from "./shared.js";

function assertRange(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigValidationError(`${label} deve estar entre ${min} e ${max} (recebido: ${value}).`);
  }
  return value;
}

/** http.d/upstreams.conf: one `upstream` block per pool referenced by an enabled host. */
export function renderUpstreams(pools: PoolGraph[]): CompiledFile {
  const nodes: ConfigNode[] = [];
  for (const pool of pools) {
    if (pool.servers.length === 0) {
      throw new ConfigValidationError(`O pool de upstream "${pool.name}" não tem servidores cadastrados.`);
    }
    const children: ConfigNode[] = [comment(`Pool #${pool.id}: ${pool.name}`)];
    if (pool.algorithm === "LEAST_CONN") children.push(directive("least_conn"));
    if (pool.algorithm === "IP_HASH") {
      if (pool.servers.some((server) => server.isBackup)) {
        throw new ConfigValidationError(
          `O pool "${pool.name}" usa IP Hash, que não aceita servidores de backup no Nginx.`,
        );
      }
      children.push(directive("ip_hash"));
    }
    for (const server of pool.servers) {
      const address = formatUpstreamAddress(sanitizeUpstreamAddress(server.address), sanitizePort(server.port));
      const args = [
        address,
        `weight=${assertRange(server.weight, 1, 1000, "Peso")}`,
        `max_fails=${assertRange(server.maxFails, 0, 100, "max_fails")}`,
        `fail_timeout=${assertRange(server.failTimeoutSeconds, 1, 3600, "fail_timeout")}s`,
      ];
      if (server.isBackup) args.push("backup");
      if (server.isDown) args.push("down");
      children.push(directive("server", ...args));
    }
    if (pool.keepaliveConnections > 0) {
      children.push(directive("keepalive", assertRange(pool.keepaliveConnections, 1, 1024, "Keepalive")));
    }
    nodes.push(block("upstream", [poolName(pool.id)], children), blank());
  }
  return configFile(fileRefs.upstreams(), nodes, "Upstream pools referenced by enabled proxy hosts.");
}

/** http.d/rate-limits.conf: one `limit_req_zone` per active rate limit rule. */
export function renderRateLimitZones(hosts: HostGraph[]): CompiledFile {
  const nodes: ConfigNode[] = [];
  for (const host of hosts) {
    if (!host.edgeProtectionEnabled) continue;
    for (const rule of host.rateLimitRules) {
      const key = rule.key === "IP_AND_PATH" ? "$binary_remote_addr$uri" : "$binary_remote_addr";
      const unit = rule.period === "MINUTE" ? "r/m" : "r/s";
      nodes.push(
        comment(`Host #${host.id}, rule #${rule.id}: ${rule.name}`),
        directive(
          "limit_req_zone",
          key,
          `zone=${rateLimitZoneName(rule.id)}:${assertRange(rule.zoneSizeMb, 1, 512, "Tamanho da zona")}m`,
          `rate=${assertRange(rule.requests, 1, 100000, "Requisições")}${unit}`,
        ),
      );
    }
  }
  return configFile(fileRefs.rateLimits(), nodes, "Rate limit zones (limit_req_zone) per rule.");
}

/** ip-lists/list-{id}.conf: allow/deny lines included by hosts and locations. */
export function renderIpList(list: IpListGraph): CompiledFile {
  const action = list.type === "ALLOWLIST" ? "allow" : "deny";
  const nodes = list.entries.map((entry) => directive(action, sanitizeIpOrCidr(entry.cidr)));
  return configFile(fileRefs.ipList(list.id), nodes, `IP list #${list.id} (${list.type}): ${list.name}`);
}

/** htpasswd/realm-{id}: user:hash lines for auth_basic_user_file. */
export function renderHtpasswd(realm: RealmGraph): CompiledFile {
  const lines = realm.users.map(
    (user) =>
      `${sanitizeBasicAuthUsername(user.username)}:${sanitizePasswordHash(user.passwordHash, user.hashAlgorithm)}`,
  );
  return textFile(fileRefs.htpasswd(realm.id), lines.length > 0 ? `${lines.join("\n")}\n` : "");
}

/** certs/{id}/fullchain.pem and privkey.pem. */
export function renderCertificate(material: CertificateMaterial): CompiledFile[] {
  const certificate = sanitizePem(material.certificatePem, "Certificado");
  const chain = material.chainPem ? sanitizePem(material.chainPem, "Cadeia intermediária") : "";
  return [
    textFile(fileRefs.certificateChain(material.id), `${certificate}${chain}`),
    textFile(fileRefs.certificateKey(material.id), sanitizePem(material.privateKeyPem, "Chave privada"), PRIVATE_KEY_MODE),
  ];
}
