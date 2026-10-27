import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { z } from "zod";
import { ConfigValidationError } from "./errors.js";

/*
 * Validators for every user-supplied value that ends up in an Nginx file.
 *
 * They run twice: in the API (through the Zod helpers at the bottom) and again
 * in the compiler, so a value that bypassed the API (seed script, manual SQL)
 * still cannot inject directives. The builder adds a third layer by refusing
 * unsafe characters in every token it renders.
 */

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const DOMAIN_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const PLAIN_PATH = /^\/[A-Za-z0-9._~\-/%@:+,=!]*$/;
const WILDCARD_PATH = /^\/[A-Za-z0-9._~\-/%@:+,=!*]*$/;
const HEADER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
const BASIC_AUTH_USERNAME = /^[A-Za-z0-9._@-]{1,64}$/;
const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const APR1_HASH = /^\$apr1\$[./0-9A-Za-z]{1,8}\$[./0-9A-Za-z]{22}$/;
const PEM_BLOCK = /^-----BEGIN [A-Z0-9 ]+-----\r?\n[A-Za-z0-9+/=\r\n]+-----END [A-Z0-9 ]+-----\s*$/;

/** Request headers the proxy manages itself and users may not override. */
const PROTECTED_REQUEST_HEADERS = new Set(["connection", "upgrade", "content-length", "transfer-encoding"]);

function fail(message: string, field?: string): never {
  throw new ConfigValidationError(message, field);
}

function assertNoControlChars(value: string, label: string, field?: string): void {
  if (CONTROL_CHARS.test(value)) {
    fail(`${label} contém caracteres de controle (quebras de linha não são permitidas).`, field);
  }
}

/** Server name: example.com, sub.example.com, *.example.com or an IDN. */
export function sanitizeDomain(input: string, field = "domain"): string {
  const trimmed = input.trim().toLowerCase().replace(/\.$/, "");
  assertNoControlChars(trimmed, "Domínio", field);
  const wildcard = trimmed.startsWith("*.");
  const base = wildcard ? trimmed.slice(2) : trimmed;
  const ascii = domainToASCII(base);
  if (!ascii || ascii.length > 253) {
    fail(`Domínio inválido: "${input}".`, field);
  }
  const labels = ascii.split(".");
  if (labels.some((label) => !DOMAIN_LABEL.test(label))) {
    fail(`Domínio inválido: "${input}". Use apenas letras, números, hífens e pontos.`, field);
  }
  if (wildcard && labels.length < 2) {
    fail(`Curinga inválido: "${input}". Use o formato *.exemplo.com.`, field);
  }
  return wildcard ? `*.${ascii}` : ascii;
}

/** Upstream address: hostname, IPv4 or IPv6 (returned without brackets). */
export function sanitizeUpstreamAddress(input: string, field = "address"): string {
  const trimmed = input.trim().replace(/^\[(.*)\]$/, "$1");
  assertNoControlChars(trimmed, "Endereço", field);
  if (isIP(trimmed)) {
    return trimmed.toLowerCase();
  }
  if (trimmed.startsWith("*.")) {
    fail(`Endereço de upstream não pode ser curinga: "${input}".`, field);
  }
  return sanitizeDomain(trimmed, field);
}

/** Renders an upstream address for `server` / `proxy_pass` (IPv6 in brackets). */
export function formatUpstreamAddress(address: string, port: number): string {
  const host = isIP(address) === 6 ? `[${address}]` : address;
  return `${host}:${port}`;
}

export function sanitizePort(input: number, field = "port"): number {
  if (!Number.isInteger(input) || input < 1 || input > 65535) {
    fail(`Porta inválida: ${input}. Use um valor entre 1 e 65535.`, field);
  }
  return input;
}

/** IP or CIDR block, normalized (e.g. "10.0.0.0/8", "2001:db8::/32"). */
export function sanitizeIpOrCidr(input: string, field = "cidr"): string {
  const trimmed = input.trim().toLowerCase();
  assertNoControlChars(trimmed, "Endereço IP", field);
  const [address = "", prefix, ...rest] = trimmed.split("/");
  const version = isIP(address);
  if (!version || rest.length > 0) {
    fail(`IP ou bloco CIDR inválido: "${input}".`, field);
  }
  if (prefix === undefined) {
    return address;
  }
  const max = version === 4 ? 32 : 128;
  if (!/^\d{1,3}$/.test(prefix) || Number(prefix) > max) {
    fail(`Prefixo CIDR inválido em "${input}" (máximo /${max}).`, field);
  }
  return `${address}/${Number(prefix)}`;
}

/** Literal path for EXACT / PREFIX matches. */
export function sanitizePath(input: string, field = "path"): string {
  const trimmed = input.trim();
  if (trimmed.length > 512 || !PLAIN_PATH.test(trimmed)) {
    fail(
      `Caminho inválido: "${input}". Deve começar com "/" e conter apenas letras, números e . _ ~ - / % @ : + , = !`,
      field,
    );
  }
  return trimmed;
}

/** Glob path where "*" matches any sequence of characters. */
export function sanitizeWildcardPath(input: string, field = "path"): string {
  const trimmed = input.trim();
  if (trimmed.length > 512 || !WILDCARD_PATH.test(trimmed)) {
    fail(`Caminho com curinga inválido: "${input}". Use "/" no início e "*" como curinga.`, field);
  }
  return trimmed;
}

/**
 * PCRE used in `location ~ "..."` or `if ($uri ~ "...")`. Rendered inside
 * double quotes, so quotes and control characters are refused; "$" is only
 * accepted as an end anchor (never as a variable).
 */
export function sanitizeRegex(input: string, field = "path"): string {
  const value = input.trim();
  if (value.length === 0 || value.length > 512) {
    fail("A expressão regular deve ter entre 1 e 512 caracteres.", field);
  }
  assertNoControlChars(value, "A expressão regular", field);
  if (/["'`]/.test(value)) {
    fail("A expressão regular não pode conter aspas ou crase.", field);
  }
  if (/\$(?![)|]|$)/.test(value.replace(/\\\$/g, ""))) {
    fail('Na expressão regular, "$" só é permitido como âncora de fim.', field);
  }
  try {
    new RegExp(value);
  } catch {
    fail(`Expressão regular inválida: ${value}`, field);
  }
  return value;
}

/** Converts a glob path ("/blog/*") into an anchored regex with one capture per "*". */
export function wildcardToRegex(path: string): string {
  const escaped = path
    .split("*")
    .map((segment) => escapeRegex(segment))
    .join("(.*)");
  return `^${escaped}$`;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

export function sanitizeHeaderName(input: string, phase: "REQUEST" | "RESPONSE", field = "headerName"): string {
  const trimmed = input.trim();
  if (!HEADER_NAME.test(trimmed)) {
    fail(`Nome de cabeçalho inválido: "${input}". Use letras, números e hífens.`, field);
  }
  if (phase === "REQUEST" && PROTECTED_REQUEST_HEADERS.has(trimmed.toLowerCase())) {
    fail(`O cabeçalho "${trimmed}" é gerenciado pelo proxy e não pode ser alterado.`, field);
  }
  return trimmed;
}

/**
 * Header value. Rendered inside double quotes, so ";", "{", "}" and single
 * quotes are harmless (CSP needs them); quotes, backslashes, "$" (variable
 * interpolation) and control characters are refused.
 */
export function sanitizeHeaderValue(input: string, field = "headerValue"): string {
  if (input.length > 4096) {
    fail("Valor de cabeçalho muito longo (máximo 4096 caracteres).", field);
  }
  assertNoControlChars(input, "Valor de cabeçalho", field);
  if (/["\\$]/.test(input)) {
    fail('Valor de cabeçalho não pode conter aspas duplas, "\\" ou "$".', field);
  }
  return input;
}

/** Free text rendered inside double quotes (auth realm, comments). */
export function sanitizeQuotedText(input: string, label: string, maxLength: number, field?: string): string {
  if (input.length > maxLength) {
    fail(`${label} muito longo (máximo ${maxLength} caracteres).`, field);
  }
  assertNoControlChars(input, label, field);
  if (/["\\$]/.test(input)) {
    fail(`${label} não pode conter aspas duplas, "\\" ou "$".`, field);
  }
  return input;
}

/**
 * Absolute http(s) URL (redirect target, external auth endpoint).
 * With `allowCaptures`, "$1".."$9" may reference regex captures.
 */
export function sanitizeUrl(input: string, options: { allowCaptures?: boolean; field?: string } = {}): string {
  const field = options.field ?? "url";
  const value = input.trim();
  if (value.length > 2048) {
    fail("URL muito longa (máximo 2048 caracteres).", field);
  }
  assertNoControlChars(value, "URL", field);
  if (/[\s"'`\\{}<>]/.test(value)) {
    fail(`URL inválida: "${input}". Espaços, aspas, chaves e "\\" não são permitidos.`, field);
  }
  const withoutCaptures = options.allowCaptures ? value.replace(/\$[1-9]/g, "") : value;
  if (withoutCaptures.includes("$")) {
    fail(
      options.allowCaptures
        ? 'Na URL, "$" só é permitido como referência de captura ($1 a $9).'
        : 'A URL não pode conter "$".',
      field,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(withoutCaptures);
  } catch {
    fail(`URL inválida: "${input}". Use o formato https://exemplo.com/caminho.`, field);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail("A URL deve começar com http:// ou https://.", field);
  }
  if (parsed.username || parsed.password) {
    fail("A URL não pode conter usuário e senha.", field);
  }
  sanitizeUpstreamAddress(parsed.hostname, field);
  return value;
}

export function sanitizeBasicAuthUsername(input: string, field = "username"): string {
  if (!BASIC_AUTH_USERNAME.test(input)) {
    fail("Usuário inválido. Use de 1 a 64 caracteres entre letras, números e . _ @ -", field);
  }
  return input;
}

export function sanitizePasswordHash(hash: string, algorithm: "BCRYPT" | "APR1", field = "passwordHash"): string {
  const valid = algorithm === "BCRYPT" ? BCRYPT_HASH.test(hash) : APR1_HASH.test(hash);
  if (!valid) {
    fail("Hash de senha inválido.", field);
  }
  return hash;
}

export function sanitizePem(input: string, label: string, field?: string): string {
  const value = input.trim();
  if (!value.split(/(?=-----BEGIN )/).every((block) => PEM_BLOCK.test(block.trim()))) {
    fail(`${label} não está em formato PEM válido.`, field);
  }
  return `${value}\n`;
}

/**
 * Admin-only escape hatch. The text is rendered verbatim, so the only check is
 * structural: braces must balance (outside quotes and comments) so the text
 * cannot close the surrounding server/location block.
 */
export function sanitizeCustomDirectives(input: string, field = "customDirectives"): string {
  if (input.length > 16384) {
    fail("Diretivas personalizadas muito longas (máximo 16 KB).", field);
  }
  if (input.includes("\u0000")) {
    fail("Diretivas personalizadas contêm caracteres inválidos.", field);
  }
  let depth = 0;
  let quote: string | null = null;
  let comment = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (comment) {
      if (char === "\n") comment = false;
      continue;
    }
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "#") comment = true;
    else if (char === '"' || char === "'") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth < 0) fail("Diretivas personalizadas fecham um bloco que não abriram.", field);
    }
  }
  if (quote) fail("Diretivas personalizadas têm aspas sem fechamento.", field);
  if (depth !== 0) fail("Diretivas personalizadas têm chaves sem fechamento.", field);
  return input.trim();
}

// ---------------------------------------------------------------------------
// Zod helpers used by the API schemas
// ---------------------------------------------------------------------------

/** Wraps a sanitizer as a Zod string schema that outputs the normalized value. */
export function zSanitized(sanitizer: (value: string) => string) {
  return z.string().transform((value, ctx) => {
    try {
      return sanitizer(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "Valor inválido.",
      });
      return z.NEVER;
    }
  });
}

export const zDomain = zSanitized((value) => sanitizeDomain(value));
export const zUpstreamAddress = zSanitized((value) => sanitizeUpstreamAddress(value));
export const zIpOrCidr = zSanitized((value) => sanitizeIpOrCidr(value));
export const zHeaderValue = zSanitized((value) => sanitizeHeaderValue(value));
export const zUrl = zSanitized((value) => sanitizeUrl(value));
export const zCustomDirectives = zSanitized((value) => sanitizeCustomDirectives(value));
export const zPort = z.number().int().min(1).max(65535);
