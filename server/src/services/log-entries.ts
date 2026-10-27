/** One line of the orla_json access log (see deploy/nginx/nginx.conf). */
export interface AccessLogEntry {
  time: string;
  hostId: number;
  host: string;
  remoteAddr: string;
  requestId: string;
  scheme: string;
  protocol: string;
  method: string;
  path: string;
  query: string;
  status: number;
  bytesSent: number;
  requestLength: number;
  requestTimeMs: number;
  upstreamTimeMs: number;
  upstreamAddr: string;
  upstreamStatus: string;
  cacheStatus: string;
  referer: string;
  userAgent: string;
}

export interface ErrorLogEntry {
  time: string;
  level: string;
  message: string;
}

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Sum of comma/colon separated upstream times ("0.010, 0.020 : 0.005"). */
const seconds = (value: unknown): number =>
  String(value ?? "")
    .split(/[,:]/)
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part))
    .reduce((total, part) => total + part, 0);

export function parseAccessLine(line: string): AccessLogEntry | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  const time = String(raw.time ?? "");
  if (!time) return null;
  return {
    time,
    hostId: Math.trunc(num(raw.host_id)),
    host: String(raw.host ?? ""),
    remoteAddr: String(raw.remote_addr ?? ""),
    requestId: String(raw.request_id ?? ""),
    scheme: String(raw.scheme ?? ""),
    protocol: String(raw.protocol ?? ""),
    method: String(raw.method ?? ""),
    path: String(raw.path ?? ""),
    query: String(raw.query ?? ""),
    status: Math.trunc(num(raw.status)),
    bytesSent: Math.trunc(num(raw.bytes_sent)),
    requestLength: Math.trunc(num(raw.request_length)),
    requestTimeMs: Math.round(num(raw.request_time) * 1000),
    upstreamTimeMs: Math.round(seconds(raw.upstream_response_time) * 1000),
    upstreamAddr: String(raw.upstream_addr ?? ""),
    upstreamStatus: String(raw.upstream_status ?? ""),
    cacheStatus: String(raw.cache_status ?? "NONE"),
    referer: String(raw.referer ?? ""),
    userAgent: String(raw.user_agent ?? ""),
  };
}

const ERROR_LINE = /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (.*)$/;

export function parseErrorLine(line: string): ErrorLogEntry {
  const match = ERROR_LINE.exec(line);
  if (!match) return { time: "", level: "info", message: line };
  const [, time = "", level = "error", message = ""] = match;
  return { time: time.replace(/\//g, "-").replace(" ", "T"), level, message };
}
