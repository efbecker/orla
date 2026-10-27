import type { DnsProviderType } from "@prisma/client";
import { z } from "zod";

/*
 * DNS-01 challenge solvers. Each provider creates and deletes the
 * `_acme-challenge.<domain>` TXT record through the provider's REST API.
 */

export const dnsCredentialsSchema = z.object({ apiToken: z.string().trim().min(10).max(512) });
export type DnsCredentials = z.infer<typeof dnsCredentialsSchema>;

export interface TxtRecordRef {
  zoneId: string;
  recordId: string;
}

export interface DnsSolver {
  createTxt(fqdn: string, value: string): Promise<TxtRecordRef>;
  removeTxt(ref: TxtRecordRef): Promise<void>;
}

const TIMEOUT_MS = 20_000;

async function requestJson<T>(url: string, init: RequestInit, provider: string): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${provider}: HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** Candidate zone names for a FQDN, most specific first (a.b.example.com -> b.example.com -> example.com). */
export function zoneCandidates(fqdn: string): string[] {
  const labels = fqdn.replace(/\.$/, "").split(".");
  const candidates: string[] = [];
  for (let index = 1; index < labels.length - 1; index += 1) {
    candidates.push(labels.slice(index).join("."));
  }
  return candidates;
}

function relativeName(fqdn: string, zone: string): string {
  return fqdn === zone ? "@" : fqdn.slice(0, -(zone.length + 1));
}

class CloudflareSolver implements DnsSolver {
  private readonly base = "https://api.cloudflare.com/client/v4";

  constructor(private readonly token: string) {}

  private headers() {
    return { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" };
  }

  async createTxt(fqdn: string, value: string): Promise<TxtRecordRef> {
    for (const zone of zoneCandidates(fqdn)) {
      const zones = await requestJson<{ result: Array<{ id: string }> }>(
        `${this.base}/zones?name=${encodeURIComponent(zone)}`,
        { headers: this.headers() },
        "Cloudflare",
      );
      const zoneId = zones.result[0]?.id;
      if (!zoneId) continue;
      const created = await requestJson<{ result: { id: string } }>(
        `${this.base}/zones/${zoneId}/dns_records`,
        { method: "POST", headers: this.headers(), body: JSON.stringify({ type: "TXT", name: fqdn, content: value, ttl: 60 }) },
        "Cloudflare",
      );
      return { zoneId, recordId: created.result.id };
    }
    throw new Error(`Cloudflare: nenhuma zona encontrada para ${fqdn}.`);
  }

  async removeTxt(ref: TxtRecordRef): Promise<void> {
    await requestJson(`${this.base}/zones/${ref.zoneId}/dns_records/${ref.recordId}`, { method: "DELETE", headers: this.headers() }, "Cloudflare");
  }
}

class DigitalOceanSolver implements DnsSolver {
  private readonly base = "https://api.digitalocean.com/v2";

  constructor(private readonly token: string) {}

  private headers() {
    return { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" };
  }

  async createTxt(fqdn: string, value: string): Promise<TxtRecordRef> {
    for (const zone of zoneCandidates(fqdn)) {
      const response = await fetch(`${this.base}/domains/${encodeURIComponent(zone)}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 404) continue;
      if (!response.ok) throw new Error(`DigitalOcean: HTTP ${response.status}`);
      const created = await requestJson<{ domain_record: { id: number } }>(
        `${this.base}/domains/${encodeURIComponent(zone)}/records`,
        {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({ type: "TXT", name: relativeName(fqdn, zone), data: value, ttl: 30 }),
        },
        "DigitalOcean",
      );
      return { zoneId: zone, recordId: String(created.domain_record.id) };
    }
    throw new Error(`DigitalOcean: nenhum domínio encontrado para ${fqdn}.`);
  }

  async removeTxt(ref: TxtRecordRef): Promise<void> {
    await requestJson(
      `${this.base}/domains/${encodeURIComponent(ref.zoneId)}/records/${ref.recordId}`,
      { method: "DELETE", headers: this.headers() },
      "DigitalOcean",
    );
  }
}

class HetznerSolver implements DnsSolver {
  private readonly base = "https://dns.hetzner.com/api/v1";

  constructor(private readonly token: string) {}

  private headers() {
    return { "Auth-API-Token": this.token, "Content-Type": "application/json" };
  }

  async createTxt(fqdn: string, value: string): Promise<TxtRecordRef> {
    for (const zone of zoneCandidates(fqdn)) {
      const zones = await requestJson<{ zones?: Array<{ id: string; name: string }> }>(
        `${this.base}/zones?name=${encodeURIComponent(zone)}`,
        { headers: this.headers() },
        "Hetzner",
      ).catch(() => ({ zones: [] }));
      const zoneId = zones.zones?.find((candidate) => candidate.name === zone)?.id;
      if (!zoneId) continue;
      const created = await requestJson<{ record: { id: string } }>(
        `${this.base}/records`,
        {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({ zone_id: zoneId, type: "TXT", name: relativeName(fqdn, zone), value, ttl: 60 }),
        },
        "Hetzner",
      );
      return { zoneId, recordId: created.record.id };
    }
    throw new Error(`Hetzner: nenhuma zona encontrada para ${fqdn}.`);
  }

  async removeTxt(ref: TxtRecordRef): Promise<void> {
    await requestJson(`${this.base}/records/${ref.recordId}`, { method: "DELETE", headers: this.headers() }, "Hetzner");
  }
}

export function createDnsSolver(type: DnsProviderType, credentials: DnsCredentials): DnsSolver {
  switch (type) {
    case "CLOUDFLARE":
      return new CloudflareSolver(credentials.apiToken);
    case "DIGITALOCEAN":
      return new DigitalOceanSolver(credentials.apiToken);
    case "HETZNER":
      return new HetznerSolver(credentials.apiToken);
  }
}
