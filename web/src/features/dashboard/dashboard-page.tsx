import { CheckCircle2, Globe, Plus, XCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/page-header";
import { ErrorBlock } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RankedTable, RangePicker, RequestsChart, StatTiles, StatusBreakdown, TopVisitors } from "@/features/dashboard/analytics";
import { useAuth } from "@/lib/auth";
import { formatRelative } from "@/lib/format";
import { useAnalyticsSummary, useHosts, useSystemInfo } from "@/lib/queries";
import type { AnalyticsRange, Deployment } from "@/lib/types";

const DEPLOYMENT_LABELS: Record<Deployment["status"], string> = {
  RUNNING: "Aplicando",
  SUCCESS: "Aplicada",
  FAILED: "Falhou",
  ROLLED_BACK: "Revertida",
};

function EdgeStatusCard() {
  const info = useSystemInfo();
  if (info.isError) return <ErrorBlock error={info.error} onRetry={() => void info.refetch()} />;
  const caps = info.data?.capabilities;
  const deployment = info.data?.lastDeployment;
  const features = caps
    ? [
        { label: "HTTP/3 (QUIC)", on: caps.http3 },
        { label: "Brotli", on: caps.brotli },
        { label: "headers-more", on: caps.headersMore },
        { label: "IPv6", on: caps.ipv6 },
      ]
    : [];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Borda</CardTitle>
        <CardDescription>{caps?.nginxVersion ? `Nginx ${caps.nginxVersion}` : "Versão do Nginx não detectada"}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="grid grid-cols-2 gap-2 text-sm">
          {features.map((feature) => (
            <li key={feature.label} className="flex items-center gap-2">
              {feature.on ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}
              <span className={feature.on ? "" : "text-muted-foreground"}>{feature.label}</span>
            </li>
          ))}
        </ul>
        {deployment ? (
          <div className="rounded-md border bg-secondary/40 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">Última aplicação</span>
              <Badge variant={deployment.status === "SUCCESS" ? "success" : deployment.status === "RUNNING" ? "secondary" : "destructive"}>
                {DEPLOYMENT_LABELS[deployment.status]}
              </Badge>
            </div>
            <p className="mt-1 truncate text-muted-foreground" title={deployment.summary}>
              {deployment.summary}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{formatRelative(deployment.startedAt)}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const [range, setRange] = useState<AnalyticsRange>("24h");
  const summary = useAnalyticsSummary(range);
  const hosts = useHosts();
  const { can } = useAuth();
  const hostName = new Map((hosts.data ?? []).map((host) => [host.id, host.domains[0]?.domain ?? host.name]));
  const hostRows = (summary.data?.hosts ?? []).map((row) => ({
    key: String(row.hostId),
    value: row.hostId === 0 ? "Sem site (servidor padrão)" : (hostName.get(row.hostId) ?? `Site #${row.hostId} (excluído)`),
    requests: row.requests,
    bytesSent: row.bytesSent,
  }));

  if (hosts.data && hosts.data.length === 0) {
    return (
      <>
        <PageHeader title="Visão geral" description="Tráfego de todos os sites gerenciados pelo Orla." />
        <Card>
          <CardContent className="flex flex-col items-center px-6 py-14 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-primary">
              <Globe className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold">Adicione seu primeiro site</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Aponte o DNS do domínio para este servidor e informe para onde o tráfego deve ser encaminhado.
            </p>
            {can("EDITOR") ? (
              <Button asChild className="mt-5">
                <Link to="/hosts/new">
                  <Plus /> Adicionar site
                </Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Visão geral" description="Tráfego de todos os sites gerenciados pelo Orla." actions={<RangePicker value={range} onChange={setRange} />} />
      <div className="space-y-4">
        {summary.isError ? <ErrorBlock error={summary.error} onRetry={() => void summary.refetch()} /> : null}
        <StatTiles summary={summary.data} loading={summary.isLoading} />
        <RequestsChart range={range} />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <StatusBreakdown summary={summary.data} loading={summary.isLoading} />
          </div>
          <EdgeStatusCard />
        </div>
        <RankedTable
          title="Sites com mais tráfego"
          description="Requisições por site no período."
          columnLabel="Site"
          rows={hostRows}
          loading={summary.isLoading}
          renderValue={(row) =>
            Number(row.key) > 0 && hostName.has(Number(row.key)) ? (
              <Link to={`/hosts/${row.key}`} className="hover:text-primary hover:underline">
                {row.value}
              </Link>
            ) : (
              row.value
            )
          }
        />
        <TopVisitors range={range} />
      </div>
    </>
  );
}
