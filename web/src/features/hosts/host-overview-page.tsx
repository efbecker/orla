import { Boxes, ExternalLink, Lock, LockOpen, ShieldCheck, Wrench } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { RangePicker, RequestsChart, StatTiles, StatusBreakdown, TopVisitors } from "@/features/dashboard/analytics";
import { useHostContext } from "@/features/hosts/host-route";
import { SSL_MODE_LABELS, primaryDomain } from "@/features/hosts/labels";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { useAnalyticsSummary, useHostToggle, useSystemInfo } from "@/lib/queries";
import type { AnalyticsRange, HostFlags } from "@/lib/types";

interface ToggleSpec {
  key: keyof HostFlags;
  title: string;
  description: string;
  disabledReason?: string | null;
}

function QuickToggle({ spec, checked, disabled, onChange }: { spec: ToggleSpec; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return (
    <label htmlFor={`toggle-${spec.key}`} className="flex cursor-pointer items-start justify-between gap-4 border-t px-5 py-4 md:odd:border-r">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{spec.title}</span>
        <span className="block text-sm text-muted-foreground">{spec.disabledReason ?? spec.description}</span>
      </span>
      <Switch id={`toggle-${spec.key}`} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

export function HostOverviewPage() {
  const host = useHostContext();
  const { can } = useAuth();
  const toggle = useHostToggle(host.id);
  const info = useSystemInfo();
  const [range, setRange] = useState<AnalyticsRange>("24h");
  const summary = useAnalyticsSummary(range, host.id);
  const domain = primaryDomain(host);
  const tls = host.sslMode !== "OFF";
  const canEdit = can("EDITOR");
  const http3Supported = info.data?.capabilities.http3 ?? false;

  const toggles: ToggleSpec[] = [
    { key: "enabled", title: "Site ativo", description: "Quando desativado, o Nginx deixa de atender estes domínios." },
    {
      key: "edgeProtectionEnabled",
      title: "Proteção de borda",
      description: "Limites de requisição, cabeçalhos de segurança, bloqueio de bots e cache. Desligado, o site vira um proxy direto.",
    },
    { key: "maintenanceEnabled", title: "Modo de manutenção", description: "Responde todas as requisições com uma página 503." },
    { key: "cacheEnabled", title: "Cache", description: "Guarda respostas na borda conforme o modo de cache do site." },
    { key: "websocketEnabled", title: "WebSockets", description: "Encaminha conexões WebSocket até a origem." },
    {
      key: "forceHttps",
      title: "Sempre usar HTTPS",
      description: "Redireciona todo acesso HTTP para HTTPS (301).",
      disabledReason: tls ? null : "Disponível com SSL ativo (modo diferente de Desligado).",
    },
    { key: "http2Enabled", title: "HTTP/2", description: "Protocolo HTTP/2 para conexões HTTPS.", disabledReason: tls ? null : "Disponível com SSL ativo." },
    {
      key: "http3Enabled",
      title: "HTTP/3 (QUIC)",
      description: "Protocolo HTTP/3 sobre UDP 443.",
      disabledReason: !http3Supported ? "O Nginx deste servidor não tem suporte a HTTP/3." : tls ? null : "Disponível com SSL ativo.",
    },
  ];

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {domain}
            <a
              href={`${tls ? "https" : "http"}://${domain.replace(/^\*\./, "")}`}
              target="_blank"
              rel="noreferrer noopener"
              className="text-muted-foreground hover:text-primary"
              aria-label={`Abrir ${domain} em nova aba`}
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </span>
        }
        description={host.name !== domain ? host.name : host.description ?? undefined}
        actions={<RangePicker value={range} onChange={setRange} />}
      />

      {host.maintenanceEnabled ? (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-warning/50 bg-warning/10 px-4 py-3 text-sm">
          <Wrench className="h-4 w-4 shrink-0" />
          O modo de manutenção está ligado: os visitantes recebem a página 503.
        </div>
      ) : null}

      <div className="space-y-4">
        <StatTiles summary={summary.data} loading={summary.isLoading} />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <RequestsChart range={range} hostId={host.id} />
            <StatusBreakdown summary={summary.data} loading={summary.isLoading} />
          </div>
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Resumo</CardTitle>
              </CardHeader>
              <CardContent className="divide-y">
                <InfoRow label="Domínios">
                  <span className="flex flex-col items-end gap-0.5 font-mono text-xs">
                    {host.domains.map((item) => (
                      <span key={item.id}>{item.domain}</span>
                    ))}
                  </span>
                </InfoRow>
                <InfoRow label="Origem">
                  {host.upstreamPool ? (
                    <span className="flex flex-col items-end gap-0.5">
                      <span className="flex items-center gap-1">
                        <Boxes className="h-3.5 w-3.5 text-muted-foreground" />
                        <Link to={`/upstreams/${host.upstreamPool.id}`} className="hover:text-primary hover:underline">
                          {host.upstreamPool.name}
                        </Link>
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {host.upstreamPool.servers
                          .slice(0, 3)
                          .map((server) => `${server.address}:${server.port}`)
                          .join(", ")}
                        {host.upstreamPool.servers.length > 3 ? ` +${host.upstreamPool.servers.length - 3}` : ""}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Sem origem</span>
                  )}
                </InfoRow>
                <InfoRow label="SSL/TLS">
                  <Badge variant={tls ? "success" : "outline"}>
                    {tls ? <Lock /> : <LockOpen />} {SSL_MODE_LABELS[host.sslMode]}
                  </Badge>
                </InfoRow>
                {host.certificate ? (
                  <InfoRow label="Certificado">
                    <span className="flex flex-col items-end">
                      <span>{host.certificate.name}</span>
                      {host.certificate.notAfter ? (
                        <span className="text-xs text-muted-foreground">Válido até {formatDate(host.certificate.notAfter)}</span>
                      ) : null}
                    </span>
                  </InfoRow>
                ) : null}
                <InfoRow label="Regras">
                  {host.locations.length} rotas · {host.redirectRules.length} redirecionamentos · {host.headerRules.length} cabeçalhos ·{" "}
                  {host.rateLimitRules.length} limites
                </InfoRow>
                <InfoRow label="Acesso">
                  <span className="flex items-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                    {host.authMode === "NONE" ? "Público" : host.authMode === "BASIC" ? "Basic Auth" : "Autenticação externa"}
                    {host.ipLists.length > 0 ? ` · ${host.ipLists.length} lista(s) de IP` : ""}
                  </span>
                </InfoRow>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle>Ajustes rápidos</CardTitle>
          </CardHeader>
          <div className="grid md:grid-cols-2">
            {toggles.map((spec) => (
              <QuickToggle
                key={spec.key}
                spec={spec}
                checked={host[spec.key]}
                disabled={!canEdit || toggle.isPending || (!!spec.disabledReason && !host[spec.key])}
                onChange={(value) => toggle.mutate({ [spec.key]: value })}
              />
            ))}
          </div>
        </Card>

        <TopVisitors range={range} hostId={host.id} />
      </div>
    </>
  );
}
