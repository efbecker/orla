import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parse } from "../lib/validation.js";
import { parseAccessLine, parseErrorLine, type AccessLogEntry, type ErrorLogEntry } from "../services/log-entries.js";
import { tailLines } from "../services/log-reader.js";

const filterSchema = z.object({
  type: z.enum(["access", "error"]).default("access"),
  hostId: z.coerce.number().int().min(0).optional(),
  status: z
    .string()
    .regex(/^([1-5]xx|[1-5]\d\d)$/, "Use um código (404) ou uma classe (4xx).")
    .optional(),
  search: z.string().trim().max(200).optional(),
});

const recentSchema = filterSchema.extend({ limit: z.coerce.number().int().min(1).max(1000).default(200) });

type Filter = z.infer<typeof filterSchema>;

function matchesAccess(entry: AccessLogEntry, filter: Filter): boolean {
  if (filter.hostId !== undefined && entry.hostId !== filter.hostId) return false;
  if (filter.status) {
    const code = String(entry.status);
    if (filter.status.endsWith("xx") ? code[0] !== filter.status[0] : code !== filter.status) return false;
  }
  if (filter.search) {
    const needle = filter.search.toLowerCase();
    const haystack = `${entry.host} ${entry.path} ${entry.query} ${entry.remoteAddr} ${entry.userAgent} ${entry.method}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function matchesError(entry: ErrorLogEntry, filter: Filter, hostNames: string[] | null): boolean {
  if (hostNames && !hostNames.some((name) => entry.message.includes(`host: "${name}"`) || entry.message.includes(`server: ${name}`))) {
    return false;
  }
  if (filter.search && !entry.message.toLowerCase().includes(filter.search.toLowerCase())) return false;
  return true;
}

export async function logRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, liveLogs } = app.orla;

  async function hostNamesFor(hostId: number | undefined): Promise<string[] | null> {
    if (hostId === undefined) return null;
    const domains = await prisma.hostDomain.findMany({ where: { hostId }, select: { domain: true } });
    return domains.map((entry) => entry.domain);
  }

  function filterLines(lines: string[], filter: Filter, hostNames: string[] | null) {
    if (filter.type === "access") {
      return lines
        .map(parseAccessLine)
        .filter((entry): entry is AccessLogEntry => entry !== null && matchesAccess(entry, filter));
    }
    return lines.map(parseErrorLine).filter((entry) => matchesError(entry, filter, hostNames));
  }

  /** Last lines of the access or error log, filtered. */
  app.get("/logs/recent", async (request) => {
    const query = parse(recentSchema, request.query);
    const hostNames = await hostNamesFor(query.hostId);
    const lines = await tailLines(liveLogs.file(query.type), query.type === "access" ? 5000 : 2000);
    return { type: query.type, items: filterLines(lines, query, hostNames).slice(-query.limit) };
  });

  /** Live log viewer: Server-Sent Events with one `log` event per batch of lines. */
  app.get("/logs/stream", { config: { queryToken: true } }, async (request, reply) => {
    const filter = parse(filterSchema, request.query);
    const hostNames = await hostNamesFor(filter.hostId);

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    raw.write(`event: ready\ndata: ${JSON.stringify({ type: filter.type })}\n\n`);

    const unsubscribe = await liveLogs.subscribe(filter.type, (lines) => {
      const entries = filterLines(lines, filter, hostNames);
      if (entries.length > 0) raw.write(`event: log\ndata: ${JSON.stringify(entries)}\n\n`);
    });
    const keepAlive = setInterval(() => raw.write(": keep-alive\n\n"), 15_000);

    request.raw.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });
}
