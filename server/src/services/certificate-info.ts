import { X509Certificate, createPrivateKey } from "node:crypto";
import { badRequest } from "../lib/http-errors.js";

export interface ParsedCertificate {
  certificatePem: string;
  chainPem: string | null;
  domains: string[];
  issuer: string;
  serialNumber: string;
  fingerprint: string;
  notBefore: Date;
  notAfter: Date;
}

const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

/** Splits a PEM bundle into the leaf certificate and the intermediate chain. */
export function splitBundle(bundle: string): { leaf: string; chain: string[] } {
  const blocks = bundle.match(PEM_CERTIFICATE) ?? [];
  const [leaf, ...chain] = blocks;
  if (!leaf) throw badRequest("Nenhum certificado PEM encontrado.");
  return { leaf: `${leaf}\n`, chain: chain.map((block) => `${block}\n`) };
}

function distinguishedNameValue(dn: string, key: string): string | undefined {
  return dn
    .split("\n")
    .map((line) => line.split("="))
    .find(([name]) => name === key)?.[1];
}

/** Reads names, validity and fingerprint from a PEM certificate (+ optional chain). */
export function parseCertificate(certificatePem: string, chainPem?: string | null): ParsedCertificate {
  const { leaf, chain } = splitBundle(certificatePem);
  const extraChain = chainPem ? splitBundle(chainPem) : null;
  const allChain = [...chain, ...(extraChain ? [extraChain.leaf, ...extraChain.chain] : [])];

  let x509: X509Certificate;
  try {
    x509 = new X509Certificate(leaf);
  } catch {
    throw badRequest("Certificado inválido ou corrompido.");
  }
  const altNames = (x509.subjectAltName ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("DNS:"))
    .map((entry) => entry.slice(4).toLowerCase());
  const commonName = distinguishedNameValue(x509.subject, "CN")?.toLowerCase();
  const domains = [...new Set(altNames.length > 0 ? altNames : commonName ? [commonName] : [])];

  return {
    certificatePem: leaf,
    chainPem: allChain.length > 0 ? allChain.join("") : null,
    domains,
    issuer: distinguishedNameValue(x509.issuer, "O") ?? distinguishedNameValue(x509.issuer, "CN") ?? x509.issuer,
    serialNumber: x509.serialNumber,
    fingerprint: x509.fingerprint256,
    notBefore: new Date(x509.validFrom),
    notAfter: new Date(x509.validTo),
  };
}

/** Ensures the private key is valid, unencrypted and matches the certificate. */
export function assertKeyMatches(certificatePem: string, privateKeyPem: string): string {
  let key;
  try {
    key = createPrivateKey(privateKeyPem);
  } catch {
    throw badRequest("Chave privada inválida ou protegida por senha (envie a chave sem senha).");
  }
  const x509 = new X509Certificate(splitBundle(certificatePem).leaf);
  if (!x509.checkPrivateKey(key)) {
    throw badRequest("A chave privada não corresponde ao certificado.");
  }
  return key.export({ type: "pkcs8", format: "pem" }).toString();
}
