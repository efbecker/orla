import type { Prisma, PrismaClient } from "@prisma/client";
import { hostInclude, ipListInclude, poolInclude, realmInclude, type CertificateMaterial, type ConfigSnapshot } from "./types.js";

export type DbClient = PrismaClient | Prisma.TransactionClient;

/** Decrypts a certificate private key stored with lib/crypto. */
export type KeyDecryptor = (encrypted: string) => string;

/** Loads everything the compiler needs, in one consistent read. */
export async function loadConfigSnapshot(db: DbClient, decrypt: KeyDecryptor): Promise<ConfigSnapshot> {
  const [hosts, pools, ipLists, realms, certificates] = await Promise.all([
    db.proxyHost.findMany({ include: hostInclude, orderBy: { id: "asc" } }),
    db.upstreamPool.findMany({ include: poolInclude, orderBy: { id: "asc" } }),
    db.ipList.findMany({ include: ipListInclude, orderBy: { id: "asc" } }),
    db.basicAuthRealm.findMany({ include: realmInclude, orderBy: { id: "asc" } }),
    db.certificate.findMany({
      where: { certificatePem: { not: null }, privateKeyEncrypted: { not: null }, status: { in: ["VALID", "EXPIRED"] } },
      orderBy: { id: "asc" },
    }),
  ]);

  const material: CertificateMaterial[] = certificates.map((certificate) => ({
    id: certificate.id,
    certificatePem: certificate.certificatePem as string,
    chainPem: certificate.chainPem,
    privateKeyPem: decrypt(certificate.privateKeyEncrypted as string),
  }));

  return { hosts, pools, ipLists, realms, certificates: material };
}
