import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

/** AES-256-GCM for secrets at rest (private keys, DNS credentials, EAB keys). */
export class SecretBox {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, "base64");
    if (this.key.length !== 32) {
      throw new Error("A chave de criptografia deve ter 32 bytes.");
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
  }

  decrypt(payload: string): string {
    const [version, iv, tag, ciphertext] = payload.split(":");
    if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
      throw new Error("Segredo cifrado em formato desconhecido.");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
  }
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString("base64url");
}
