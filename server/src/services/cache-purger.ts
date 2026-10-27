import { runCommand } from "../nginx/executor.js";
import { HttpError } from "../lib/http-errors.js";

/** Purges proxy_cache entries through the root helper (see deploy/bin/orla-cache-purge). */
export class CachePurger {
  constructor(private readonly command: string[]) {}

  async purge(target: number | "all"): Promise<string> {
    const result = await runCommand([...this.command, String(target)], 120_000);
    if (!result.ok) {
      throw new HttpError(500, `Falha ao limpar o cache: ${result.output || "sem saída"}`);
    }
    return result.output;
  }
}
