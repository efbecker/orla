import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const PANEL_COST = 12;
const HTPASSWD_COST = 10;
const APR1_ALPHABET = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function hashPanelPassword(password: string): Promise<string> {
  return bcrypt.hash(password, PANEL_COST);
}

export function verifyPanelPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** bcrypt for htpasswd files ($2b$, supported by Debian's libxcrypt). */
export function hashHtpasswdBcrypt(password: string): Promise<string> {
  return bcrypt.hash(password, HTPASSWD_COST);
}

function to64(value: number, length: number): string {
  let result = "";
  let remaining = value;
  for (let index = 0; index < length; index += 1) {
    result += APR1_ALPHABET[remaining & 0x3f];
    remaining >>>= 6;
  }
  return result;
}

/** Apache MD5 ("$apr1$") crypt, compatible with `htpasswd -m` and Nginx. */
export function hashApr1(password: string, salt = randomApr1Salt()): string {
  const magic = "$apr1$";
  const pw = Buffer.from(password, "utf8");
  const saltBuffer = Buffer.from(salt.slice(0, 8), "utf8");

  let final = createHash("md5").update(Buffer.concat([pw, saltBuffer, pw])).digest();
  const context = createHash("md5").update(Buffer.concat([pw, Buffer.from(magic), saltBuffer]));
  for (let length = pw.length; length > 0; length -= 16) {
    context.update(final.subarray(0, Math.min(16, length)));
  }
  for (let bits = pw.length; bits > 0; bits >>= 1) {
    context.update(bits & 1 ? Buffer.from([0]) : pw.subarray(0, 1));
  }
  final = context.digest();

  for (let round = 0; round < 1000; round += 1) {
    const step = createHash("md5");
    step.update(round & 1 ? pw : final);
    if (round % 3) step.update(saltBuffer);
    if (round % 7) step.update(pw);
    step.update(round & 1 ? final : pw);
    final = step.digest();
  }

  const b = (index: number) => final[index] as number;
  const encoded =
    to64((b(0) << 16) | (b(6) << 8) | b(12), 4) +
    to64((b(1) << 16) | (b(7) << 8) | b(13), 4) +
    to64((b(2) << 16) | (b(8) << 8) | b(14), 4) +
    to64((b(3) << 16) | (b(9) << 8) | b(15), 4) +
    to64((b(4) << 16) | (b(10) << 8) | b(5), 4) +
    to64(b(11), 2);
  return `${magic}${saltBuffer.toString("utf8")}$${encoded}`;
}

function randomApr1Salt(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => APR1_ALPHABET[byte & 0x3f]).join("");
}
