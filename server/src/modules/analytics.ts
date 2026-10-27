import { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parse, toJsonSafe } from "../lib/validation.js";

const RANGES = {
  "1h": { ms: 3_600_000, interval: "1 minute" },
  "24h": { ms: 86_400_000, interval: "15 minutes" },
  "7d": { ms: 7 * 86_400_000, interval: "1 hour" },
  "30d": { ms: 30 * 86_400_000, interval: "6 hours" },
} as const;

const rangeQuery = z.object({
  range: z.enum(["1h", "24h", "7d", "30d"]).default("24h"),
  hostId: z.coerce.number().int().min(0).optional(),
});

const topQuery = rangeQuery.extend({
  kind: z.enum(["IP", "PATH"]).default("IP"),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

interface SeriesRow {
  bucket: Date;
  requests: bigint;
  bytesSent: bigint;
  status2xx: bigint;
  status3xx: bigint;
  status4xx: bigint;
  status5xx: bigint;
  cacheHit: bigint;
  cacheMiss: bigint;
}

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = app.orla;

  app.get("/analytics/summary", async (request) => {
    const query = parse(rangeQuery, request.query);
    const since = new Date(Date.now() - RANGES[query.range].ms);
    const where = { bucketStart: { gte: since }, ...(query.hostId !== undefined ? { hostId: query.hostId } : {}) };
    const [totals, perHost] = await Promise.all([
      prisma.trafficBucket.aggregate({
        where,
        _sum: {
          requests: true,
          bytesSent: true,
          bytesReceived: true,
          status1xx: true,
          status2xx: true,
          status3xx: true,
          status4xx: true,
          status5xx: true,
          cacheHit: true,
          cacheMiss: true,
          cacheBypass: true,
          cacheExpired: true,
          cacheOther: true,
          requestTimeSumMs: true,
          upstreamTimeSumMs: true,
        },
      }),
      prisma.trafficBucket.groupBy({
        by: ["hostId"],
        where,
        _sum: { requests: true, bytesSent: true, status5xx: true },
        orderBy: { _sum: { requests: "desc" } },
        take: 20,
      }),
    ]);
    const sum = totals._sum;
    const requests = sum.requests ?? 0;
    const cacheable = (sum.cacheHit ?? 0) + (sum.cacheMiss ?? 0) + (sum.cacheExpired ?? 0);
    return toJsonSafe({
      range: query.range,
      since,
      requests,
      bytesSent: sum.bytesSent ?? 0n,
      bytesReceived: sum.bytesReceived ?? 0n,
      status: {
        "1xx": sum.status1xx ?? 0,
        "2xx": sum.status2xx ?? 0,
        "3xx": sum.status3xx ?? 0,
        "4xx": sum.status4xx ?? 0,
        "5xx": sum.status5xx ?? 0,
      },
      cache: {
        HIT: sum.cacheHit ?? 0,
        MISS: sum.cacheMiss ?? 0,
        BYPASS: sum.cacheBypass ?? 0,
        EXPIRED: sum.cacheExpired ?? 0,
        OTHER: sum.cacheOther ?? 0,
        hitRatio: cacheable > 0 ? (sum.cacheHit ?? 0) / cacheable : null,
      },
      avgRequestTimeMs: requests > 0 ? Number(sum.requestTimeSumMs ?? 0n) / requests : null,
      avgUpstreamTimeMs: requests > 0 ? Number(sum.upstreamTimeSumMs ?? 0n) / requests : null,
      hosts: perHost.map((row) => ({
        hostId: row.hostId,
        requests: row._sum.requests ?? 0,
        bytesSent: row._sum.bytesSent ?? 0n,
        status5xx: row._sum.status5xx ?? 0,
      })),
    });
  });

  app.get("/analytics/timeseries", async (request) => {
    const query = parse(rangeQuery, request.query);
    const range = RANGES[query.range];
    const since = new Date(Date.now() - range.ms);
    const hostFilter = query.hostId !== undefined ? Prisma.sql`AND "hostId" = ${query.hostId}` : Prisma.empty;
    const rows = await prisma.$queryRaw<SeriesRow[]>`
      SELECT date_bin(${range.interval}::interval, "bucketStart", TIMESTAMP '2000-01-01') AS bucket,
             SUM("requests")::bigint AS "requests",
             SUM("bytesSent")::bigint AS "bytesSent",
             SUM("status2xx")::bigint AS "status2xx",
             SUM("status3xx")::bigint AS "status3xx",
             SUM("status4xx")::bigint AS "status4xx",
             SUM("status5xx")::bigint AS "status5xx",
             SUM("cacheHit")::bigint AS "cacheHit",
             SUM("cacheMiss")::bigint AS "cacheMiss"
        FROM "TrafficBucket"
       WHERE "bucketStart" >= ${since} ${hostFilter}
       GROUP BY bucket
       ORDER BY bucket`;
    return toJsonSafe({ range: query.range, interval: range.interval, points: rows });
  });

  app.get("/analytics/top", async (request) => {
    const query = parse(topQuery, request.query);
    const since = new Date(Date.now() - RANGES[query.range].ms);
    const rows = await prisma.trafficTopEntry.groupBy({
      by: ["value"],
      where: { kind: query.kind, bucketStart: { gte: since }, ...(query.hostId !== undefined ? { hostId: query.hostId } : {}) },
      _sum: { requests: true, bytesSent: true },
      orderBy: { _sum: { requests: "desc" } },
      take: query.limit,
    });
    return toJsonSafe({
      kind: query.kind,
      items: rows.map((row) => ({ value: row.value, requests: row._sum.requests ?? 0, bytesSent: row._sum.bytesSent ?? 0n })),
    });
  });
}
