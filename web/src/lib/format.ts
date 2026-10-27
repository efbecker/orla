const numberFormat = new Intl.NumberFormat("pt-BR");
const compactFormat = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const percentFormat = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" });
const timeFormat = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dayTimeFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export const formatNumber = (value: number): string => numberFormat.format(value);
export const formatCompact = (value: number): string => compactFormat.format(value);
export const formatPercent = (value: number): string => percentFormat.format(value);
export const formatDateTime = (value: string | number | Date): string => dateTimeFormat.format(new Date(value));
export const formatDate = (value: string | number | Date): string => dateFormat.format(new Date(value));
export const formatTime = (value: string | number | Date): string => timeFormat.format(new Date(value));
export const formatDayTime = (value: string | number | Date): string => dayTimeFormat.format(new Date(value));

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: value < 10 && exponent > 0 ? 1 : 0 })} ${BYTE_UNITS[exponent]}`;
}

export function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} s`;
  return `${ms.toLocaleString("pt-BR", { maximumFractionDigits: ms < 10 ? 1 : 0 })} ms`;
}

export function formatRelative(value: string | number | Date): string {
  const diff = new Date(value).getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), "second");
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  return rtf.format(Math.round(diff / 86_400_000), "day");
}
