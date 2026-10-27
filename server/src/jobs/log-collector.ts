import type { PrismaClient } from "@prisma/client";
import { parseAccessLine, type AccessLogEntry } from "../services/log-entries.js";
import { readNewLines, type FileCursor } from "../services/log-reader.js";

const CURSOR_KEY = "collector.accessLogCursor";
/** Distinct IPs/paths kept per host and hour in each collection pass. */
const TOP_LIMIT = 200;

interface BucketCounters {
  hostId: number;
  bucketStart: Date;
  requests: number;
  bytesSent: bigint;
  bytesReceived: bigint;
  status1xx: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  cacheHit: number;
  cacheMiss: number;
  cacheBypass: number;
  cacheExpired: number;
  cacheOther: number;
  requestTimeSumMs: bigint;
  upstreamTimeSumMs: bigint;
}

interface TopCounters {
  requests: number;
  bytesSent: bigint;
}

function floorTo(date: Date, unitMs: number): Date {
  return new Date(Math.floor(date.getTime() / unitMs) * unitMs);
}

/** Aggregates parsed access log entries into per-minute buckets and hourly top lists. */
export function aggregate(entries: AccessLogEntry[]) {
  const buckets = new Map<string, BucketCounters>();
  const tops = new Map<string, Map<string, TopCounters>>();

  for (const entry of entries) {
    const at = new Date(entry.time);
    if (Number.isNaN(at.getTime())) continue;
    const minute = floorTo(at, 60_000);
    const key = `${entry.hostId}|${minute.toISOString()}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        hostId: entry.hostId,
        bucketStart: minute,
        requests: 0,
        bytesSent: 0n,
        bytesReceived: 0n,
        status1xx: 0,
        status2xx: 0,
        status3xx: 0,
        status4xx: 0,
        status5xx: 0,
        cacheHit: 0,
        cacheMiss: 0,
        cacheBypass: 0,
        cacheExpired: 0,
        cacheOther: 0,
        requestTimeSumMs: 0n,
        upstreamTimeSumMs: 0n,
      };
      buckets.set(key, bucket);
    }
    bucket.requests += 1;
    bucket.bytesSent += BigInt(entry.bytesSent);
    bucket.bytesReceived += BigInt(entry.requestLength);
    bucket.requestTimeSumMs += BigInt(entry.requestTimeMs);
    bucket.upstreamTimeSumMs += BigInt(entry.upstreamTimeMs);
    const statusClass = Math.floor(entry.status / 100);
    if (statusClass === 1) bucket.status1xx += 1;
    else if (statusClass === 2) bucket.status2xx += 1;
    else if (statusClass === 3) bucket.status3xx += 1;
    else if (statusClass === 4) bucket.status4xx += 1;
    else if (statusClass === 5) bucket.status5xx += 1;
    switch (entry.cacheStatus) {
      case "HIT":
        bucket.cacheHit += 1;
        break;
      case "MISS":
        bucket.cacheMiss += 1;
        break;
      case "BYPASS":
        bucket.cacheBypass += 1;
        break;
      case "EXPIRED":
        bucket.cacheExpired += 1;
        break;
      case "NONE":
        break;
      default:
        bucket.cacheOther += 1;
    }

    const hour = floorTo(at, 3_600_000).toISOString();
    for (const [kind, value] of [
      ["IP", entry.remoteAddr],
      ["PATH", entry.path.slice(0, 512)],
    ] as const) {
      if (!value) continue;
      const topKey = `${entry.hostId}|${hour}|${kind}`;
      let counters = tops.get(topKey);
      if (!counters) {
        counters = new Map();
        tops.set(topKey, counters);
      }
      const current = counters.get(value) ?? { requests: 0, bytesSent: 0n };
      current.requests += 1;
      current.bytesSent += BigInt(entry.bytesSent);
      counters.set(value, current);
    }
  }

  const topEntries = [...tops].flatMap(([key, counters]) => {
    const [hostId = "0", hour = "", kind = "IP"] = key.split("|");
    return [...counters]
      .sort((a, b) => b[1].requests - a[1].requests)
      .slice(0, TOP_LIMIT)
      .map(([value, counter]) => ({
        hostId: Number(hostId),
        bucketStart: new Date(hour),
        kind: kind as "IP" | "PATH",
        value,
        requests: counter.requests,
        bytesSent: counter.bytesSent,
      }));
  });

  return { buckets: [...buckets.values()], topEntries };
}

/** Tails the JSON access log and folds new lines into TrafficBucket / TrafficTopEntry. */
export class LogCollector {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly accessLog: string,
  ) {}

  async collect(): Promise<number> {
    const stored = await this.prisma.setting.findUnique({ where: { key: CURSOR_KEY } });
    const cursor = (stored?.value as FileCursor | undefined) ?? null;
    const { lines, cursor: next } = await readNewLines(this.accessLog, cursor);
    const entries = lines.map(parseAccessLine).filter((entry): entry is AccessLogEntry => entry !== null);
    const { buckets, topEntries } = aggregate(entries);

    await this.prisma.$transaction(
      async (tx) => {
        for (const bucket of buckets) {
          const { hostId, bucketStart, ...counters } = bucket;
          await tx.trafficBucket.upsert({
            where: { hostId_bucketStart: { hostId, bucketStart } },
            create: bucket,
            update: Object.fromEntries(Object.entries(counters).map(([field, value]) => [field, { increment: value }])),
          });
        }
        for (const entry of topEntries) {
          const { hostId, bucketStart, kind, value, requests, bytesSent } = entry;
          await tx.trafficTopEntry.upsert({
            where: { hostId_bucketStart_kind_value: { hostId, bucketStart, kind, value } },
            create: entry,
            update: { requests: { increment: requests }, bytesSent: { increment: bytesSent } },
          });
        }
        await tx.setting.upsert({
          where: { key: CURSOR_KEY },
          create: { key: CURSOR_KEY, value: { ...next } },
          update: { value: { ...next } },
        });
      },
      { timeout: 120_000 },
    );
    return entries.length;
  }
}
