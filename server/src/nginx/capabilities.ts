import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/** Features of the installed Nginx, probed by orla-nginx-prepare at start. */
export const capabilitiesSchema = z.object({
  nginxVersion: z.string().default(""),
  http3: z.boolean().default(false),
  ipv6: z.boolean().default(false),
  brotli: z.boolean().default(false),
  headersMore: z.boolean().default(false),
});

export type NginxCapabilities = z.infer<typeof capabilitiesSchema>;

export const NO_CAPABILITIES: NginxCapabilities = {
  nginxVersion: "",
  http3: false,
  ipv6: false,
  brotli: false,
  headersMore: false,
};

/**
 * Reads runtime/capabilities.json. Missing or unreadable means "assume
 * nothing optional", so the compiler only emits directives every build has.
 */
export async function readCapabilities(runtimeDir: string): Promise<NginxCapabilities> {
  try {
    const raw = await readFile(path.join(runtimeDir, "capabilities.json"), "utf8");
    return capabilitiesSchema.parse(JSON.parse(raw));
  } catch {
    return NO_CAPABILITIES;
  }
}
