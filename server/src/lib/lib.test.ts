import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { SecretBox } from "./crypto.js";
import { hashApr1, hashHtpasswdBcrypt } from "./passwords.js";
import { sanitizePasswordHash } from "../nginx/sanitize.js";

describe("hashApr1", () => {
  it("matches openssl passwd -apr1", () => {
    expect(hashApr1("senha secreta", "abcdefgh")).toBe("$apr1$abcdefgh$co2U4sGeyGltq4KgVu73s.");
  });

  it("produces hashes accepted by the htpasswd sanitizer", async () => {
    expect(sanitizePasswordHash(hashApr1("x"), "APR1")).toMatch(/^\$apr1\$/);
    expect(sanitizePasswordHash(await hashHtpasswdBcrypt("x"), "BCRYPT")).toMatch(/^\$2b\$/);
  });
});

describe("SecretBox", () => {
  it("round-trips and detects tampering", () => {
    const box = new SecretBox(randomBytes(32).toString("base64"));
    const sealed = box.encrypt("-----BEGIN PRIVATE KEY-----");
    expect(box.decrypt(sealed)).toBe("-----BEGIN PRIVATE KEY-----");
    const parts = sealed.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => box.decrypt(parts.join(":"))).toThrow();
  });
});
