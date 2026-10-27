import type { LoadBalancingAlgorithm, SslMode } from "@/lib/types";

export const SSL_MODE_LABELS: Record<SslMode, string> = {
  OFF: "Desligado",
  FLEXIBLE: "Flexível",
  FULL: "Completo",
  FULL_STRICT: "Completo (estrito)",
};

export const ALGORITHM_LABELS: Record<LoadBalancingAlgorithm, string> = {
  ROUND_ROBIN: "Round robin",
  LEAST_CONN: "Menos conexões",
  IP_HASH: "IP hash (sessão fixa)",
};

export function primaryDomain(host: { name: string; domains: Array<{ domain: string }> }): string {
  return host.domains[0]?.domain ?? host.name;
}

/** Same rules as the API (sanitizeDomain): ASCII labels, optional leading "*.". */
const DOMAIN_PATTERN = /^(\*\.)?(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

/** Client-side check matching the API: IDNs are converted to punycode first. */
export function looksLikeDomain(value: string): boolean {
  const domain = normalizeDomain(value);
  if (DOMAIN_PATTERN.test(domain)) return true;
  if (/[\s/:@?#!$&'()+,;=\\"<>]/.test(domain)) return false;
  const wildcard = domain.startsWith("*.");
  try {
    const ascii = new URL(`http://${wildcard ? domain.slice(2) : domain}`).hostname;
    return DOMAIN_PATTERN.test(wildcard ? `*.${ascii}` : ascii);
  } catch {
    return false;
  }
}
