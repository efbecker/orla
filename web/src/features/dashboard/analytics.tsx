import { Activity, ArrowDownUp, Clock, DatabaseZap, ServerCrash } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { ErrorBlock } from "@/components/query-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBytes, formatCompact, formatDayTime, formatMs, formatNumber, formatPercent, formatTime } from "@/lib/format";
import { useAnalyticsTimeseries, useAnalyticsTop } from "@/lib/queries";
import type { AnalyticsRange, AnalyticsSummary, TimeseriesPoint } from "@/lib/types";
import { cn } from "@/lib/utils";

export const RANGE_OPTIONS: Array<{ value: AnalyticsRange; label: string }> = [
  { value: "1h", label: "1 hora" },
  { value: "24h", label: "24 horas" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
];

const RANGE_MS: Record<AnalyticsRange, number> = { "1h": 3_600_000, "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };
const STEP_MS: Record<AnalyticsRange, number> = { "1h": 60_000, "24h": 15 * 60_000, "7d": 3_600_000, "30d": 6 * 3_600_000 };
const STEP_LABEL: Record<AnalyticsRange, string> = { "1h": "minuto", "24h": "15 minutos", "7d": "hora", "30d": "6 horas" };
/** Same origin the API uses in date_bin(). */
const BIN_ORIGIN = Date.UTC(2000, 0, 1);

export function RangePicker({ value, onChange }: { value: AnalyticsRange; onChange: (range: AnalyticsRange) => void }) {
  return (
    <div role="radiogroup" aria-label="Período" className="inline-flex rounded-lg border bg-card p-0.5 shadow-sm">
      {RANGE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === option.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function StatTile({ icon, label, value, detail, loading }: { icon: ReactNode; label: string; value: string; detail?: string; loading: boolean }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
          {icon}
          {label}
        </div>
        {loading ? <Skeleton className="mt-3 h-8 w-24" /> : <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>}
        {detail && !loading ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : <p className="mt-1 h-4" />}
      </CardContent>
    </Card>
  );
}

export function StatTiles({ summary, loading }: { summary?: AnalyticsSummary; loading: boolean }) {
  const requests = summary?.requests ?? 0;
  const errors = summary?.status["5xx"] ?? 0;
  const hitRatio = summary?.cache.hitRatio ?? null;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile icon={<Activity />} label="Requisições" value={formatNumber(requests)} loading={loading} />
      <StatTile
        icon={<ArrowDownUp />}
        label="Banda enviada"
        value={formatBytes(summary?.bytesSent ?? 0)}
        detail={`Recebida: ${formatBytes(summary?.bytesReceived ?? 0)}`}
        loading={loading}
      />
      <StatTile
        icon={<DatabaseZap />}
        label="Taxa de acerto do cache"
        value={hitRatio === null ? "—" : formatPercent(hitRatio)}
        detail={hitRatio === null ? "Nenhuma resposta cacheável no período" : `${formatNumber(summary?.cache.HIT ?? 0)} respostas do cache`}
        loading={loading}
      />
      <StatTile
        icon={errors > 0 ? <ServerCrash /> : <Clock />}
        label={errors > 0 ? "Erros 5xx" : "Tempo médio de resposta"}
        value={errors > 0 ? formatNumber(errors) : formatMs(summary?.avgRequestTimeMs ?? null)}
        detail={
          errors > 0
            ? `${formatPercent(requests > 0 ? errors / requests : 0)} das requisições · tempo médio ${formatMs(summary?.avgRequestTimeMs ?? null)}`
            : `Origem: ${formatMs(summary?.avgUpstreamTimeMs ?? null)}`
        }
        loading={loading}
      />
    </div>
  );
}

/** Fills empty buckets with zeros so the line drops to the baseline instead of interpolating. */
function fillSeries(points: TimeseriesPoint[], range: AnalyticsRange, now: number): Array<{ time: number; requests: number; bytesSent: number }> {
  const step = STEP_MS[range];
  const byTime = new Map(points.map((point) => [new Date(point.bucket).getTime(), point]));
  const start = BIN_ORIGIN + Math.floor((now - RANGE_MS[range] - BIN_ORIGIN) / step) * step + step;
  const result: Array<{ time: number; requests: number; bytesSent: number }> = [];
  for (let time = start; time <= now; time += step) {
    const point = byTime.get(time);
    result.push({ time, requests: point?.requests ?? 0, bytesSent: point?.bytesSent ?? 0 });
  }
  return result;
}

function ChartTooltip({ active, payload, range }: TooltipProps<number, string> & { range: AnalyticsRange }) {
  const item = payload?.[0]?.payload as { time: number; requests: number; bytesSent: number } | undefined;
  if (!active || !item) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{range === "1h" || range === "24h" ? formatTime(item.time) : formatDayTime(item.time)}</p>
      <p className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: "var(--series-1)" }} />
        <span className="text-muted-foreground">Requisições</span>
        <span className="ml-auto font-semibold tabular">{formatNumber(item.requests)}</span>
      </p>
      <p className="mt-0.5 flex items-center gap-2 pl-4">
        <span className="text-muted-foreground">Banda</span>
        <span className="ml-auto tabular">{formatBytes(item.bytesSent)}</span>
      </p>
    </div>
  );
}

export function RequestsChart({ range, hostId }: { range: AnalyticsRange; hostId?: number }) {
  const series = useAnalyticsTimeseries(range, hostId);
  const data = useMemo(() => fillSeries(series.data?.points ?? [], range, Date.now()), [series.data, range]);
  const total = data.reduce((sum, point) => sum + point.requests, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Requisições</CardTitle>
        <CardDescription>Total a cada {STEP_LABEL[range]}.</CardDescription>
      </CardHeader>
      <CardContent>
        {series.isError ? (
          <ErrorBlock error={series.error} onRetry={() => void series.refetch()} />
        ) : series.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="relative h-64">
            {total === 0 ? (
              <p className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">Sem tráfego registrado neste período.</p>
            ) : null}
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="requestsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis
                  dataKey="time"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(value: number) => (range === "1h" || range === "24h" ? formatTime(value) : formatDayTime(value))}
                  tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--chart-grid)" }}
                  minTickGap={40}
                />
                <YAxis
                  tickFormatter={(value: number) => formatCompact(value)}
                  tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  allowDecimals={false}
                />
                <Tooltip content={<ChartTooltip range={range} />} cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }} />
                <Area
                  type="monotone"
                  dataKey="requests"
                  stroke="var(--series-1)"
                  strokeWidth={2}
                  fill="url(#requestsFill)"
                  isAnimationActive={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--chart-surface)" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const STATUS_CLASSES = [
  { key: "2xx", label: "2xx Sucesso", color: "var(--series-1)" },
  { key: "3xx", label: "3xx Redirecionamento", color: "var(--series-2)" },
  { key: "4xx", label: "4xx Erro do cliente", color: "var(--series-3)" },
  { key: "5xx", label: "5xx Erro do servidor", color: "var(--series-4)" },
] as const;

export function StatusBreakdown({ summary, loading }: { summary?: AnalyticsSummary; loading: boolean }) {
  const total = STATUS_CLASSES.reduce((sum, item) => sum + (summary?.status[item.key] ?? 0), 0);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Códigos de resposta</CardTitle>
        <CardDescription>Distribuição das respostas por classe de status.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label="Distribuição por status">
              {total > 0
                ? STATUS_CLASSES.map((item) => {
                    const value = summary?.status[item.key] ?? 0;
                    if (value === 0) return null;
                    return (
                      <div
                        key={item.key}
                        className="h-full first:rounded-l-full last:rounded-r-full"
                        style={{ width: `${(value / total) * 100}%`, background: item.color }}
                        title={`${item.label}: ${formatNumber(value)}`}
                      />
                    );
                  })
                : null}
            </div>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {STATUS_CLASSES.map((item) => {
                const value = summary?.status[item.key] ?? 0;
                return (
                  <li key={item.key} className="flex items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: item.color }} />
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="ml-auto font-medium tabular">{formatNumber(value)}</span>
                    <span className="w-14 text-right text-xs text-muted-foreground tabular">{total > 0 ? formatPercent(value / total) : "—"}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function RankedTable({
  title,
  description,
  columnLabel,
  rows,
  loading,
  error,
  onRetry,
  renderValue,
}: {
  title: string;
  description: string;
  columnLabel: string;
  rows: Array<{ key: string; value: string; requests: number; bytesSent: number }>;
  loading: boolean;
  error?: unknown;
  onRetry?: () => void;
  renderValue?: (row: { key: string; value: string }) => ReactNode;
}) {
  const max = rows.reduce((top, row) => Math.max(top, row.requests), 0);
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {error ? (
        <CardContent>
          <ErrorBlock error={error} onRetry={onRetry} />
        </CardContent>
      ) : loading ? (
        <CardContent>
          <Skeleton className="h-40 w-full" />
        </CardContent>
      ) : rows.length === 0 ? (
        <CardContent>
          <p className="py-6 text-center text-sm text-muted-foreground">Nada registrado neste período.</p>
        </CardContent>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{columnLabel}</TableHead>
              <TableHead className="text-right">Requisições</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Banda</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="max-w-0 py-2">
                  <div className="truncate font-mono text-xs" title={row.value}>
                    {renderValue ? renderValue(row) : row.value}
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-muted">
                    <div className="h-1 rounded-full" style={{ width: `${max > 0 ? (row.requests / max) * 100 : 0}%`, background: "var(--series-1)" }} />
                  </div>
                </TableCell>
                <TableCell className="w-28 py-2 text-right tabular">{formatNumber(row.requests)}</TableCell>
                <TableCell className="hidden w-28 py-2 text-right text-muted-foreground tabular sm:table-cell">{formatBytes(row.bytesSent)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

export function TopVisitors({ range, hostId }: { range: AnalyticsRange; hostId?: number }) {
  const ips = useAnalyticsTop(range, "IP", hostId);
  const paths = useAnalyticsTop(range, "PATH", hostId);
  const toRows = (items: Array<{ value: string; requests: number; bytesSent: number }> | undefined) =>
    (items ?? []).map((item) => ({ key: item.value, ...item }));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <RankedTable
        title="Principais IPs"
        description="Clientes com mais requisições."
        columnLabel="Endereço IP"
        rows={toRows(ips.data?.items)}
        loading={ips.isLoading}
        error={ips.error}
        onRetry={() => void ips.refetch()}
      />
      <RankedTable
        title="Caminhos mais acessados"
        description="URLs com mais requisições (sem query string)."
        columnLabel="Caminho"
        rows={toRows(paths.data?.items)}
        loading={paths.isLoading}
        error={paths.error}
        onRetry={() => void paths.refetch()}
      />
    </div>
  );
}
