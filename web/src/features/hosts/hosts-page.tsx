import { ChevronRight, Globe, Lock, LockOpen, Plus, Search, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorBlock, LoadingBlock } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SSL_MODE_LABELS, primaryDomain } from "@/features/hosts/labels";
import { useAuth } from "@/lib/auth";
import { useHostToggle, useHosts } from "@/lib/queries";
import type { HostListItem } from "@/lib/types";

function HostRow({ host, canEdit }: { host: HostListItem; canEdit: boolean }) {
  const toggle = useHostToggle(host.id);
  const domain = primaryDomain(host);
  const extra = host.domains.length - 1;
  const origin = host.upstreamPool
    ? `${host.upstreamPool.scheme.toLowerCase()}:// ${host.upstreamPool.name}${host.upstreamPool._count.servers > 1 ? ` (${host.upstreamPool._count.servers} servidores)` : ""}`
    : "Sem origem";
  const rules = host._count.locations + host._count.redirectRules + host._count.headerRules + host._count.rateLimitRules;

  return (
    <li className="flex items-center gap-4 border-b px-4 py-3 last:border-0 hover:bg-secondary/40 sm:px-5">
      <span
        className={host.enabled ? "h-2.5 w-2.5 shrink-0 rounded-full bg-success" : "h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground/40"}
        aria-label={host.enabled ? "Ativo" : "Desativado"}
      />
      <Link to={`/hosts/${host.id}`} className="group min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium group-hover:text-primary">{domain}</span>
          {extra > 0 ? <Badge variant="secondary">+{extra}</Badge> : null}
          {host.maintenanceEnabled ? (
            <Badge variant="warning">
              <Wrench /> Manutenção
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {host.name !== domain ? `${host.name} · ` : ""}
          {origin}
          {rules > 0 ? ` · ${rules} regra${rules === 1 ? "" : "s"}` : ""}
        </p>
      </Link>
      <div className="hidden w-40 shrink-0 md:block">
        <Badge variant={host.sslMode === "OFF" ? "outline" : "success"}>
          {host.sslMode === "OFF" ? <LockOpen /> : <Lock />}
          SSL {SSL_MODE_LABELS[host.sslMode]}
        </Badge>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Switch
              checked={host.enabled}
              disabled={!canEdit || toggle.isPending}
              onCheckedChange={(enabled) => toggle.mutate({ enabled })}
              aria-label={`${host.enabled ? "Desativar" : "Ativar"} ${domain}`}
            />
          </span>
        </TooltipTrigger>
        <TooltipContent>{host.enabled ? "Site ativo: o Nginx atende este domínio" : "Site desativado: o domínio não é atendido"}</TooltipContent>
      </Tooltip>
      <Link to={`/hosts/${host.id}`} className="hidden text-muted-foreground hover:text-foreground sm:block" aria-label={`Abrir ${domain}`}>
        <ChevronRight className="h-4 w-4" />
      </Link>
    </li>
  );
}

export function HostsPage() {
  const hosts = useHosts();
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const canEdit = can("EDITOR");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return hosts.data ?? [];
    return (hosts.data ?? []).filter(
      (host) =>
        host.name.toLowerCase().includes(term) ||
        host.domains.some((domain) => domain.domain.includes(term)) ||
        host.upstreamPool?.name.toLowerCase().includes(term),
    );
  }, [hosts.data, search]);

  const addButton = canEdit ? (
    <Button asChild>
      <Link to="/hosts/new">
        <Plus /> Adicionar site
      </Link>
    </Button>
  ) : null;

  return (
    <>
      <PageHeader title="Sites" description="Domínios atendidos por este servidor e para onde o tráfego é encaminhado." actions={addButton} />
      {hosts.isLoading ? (
        <LoadingBlock rows={4} />
      ) : hosts.isError ? (
        <ErrorBlock error={hosts.error} onRetry={() => void hosts.refetch()} />
      ) : (hosts.data ?? []).length === 0 ? (
        <EmptyState
          icon={<Globe />}
          title="Nenhum site ainda"
          description="Adicione um domínio, aponte o DNS para este servidor e informe a origem. O Orla gera e valida a configuração do Nginx."
          action={addButton}
        />
      ) : (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por domínio, nome ou origem" className="pl-9" aria-label="Buscar sites" />
          </div>
          <Card className="overflow-hidden">
            {filtered.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">Nenhum site corresponde à busca.</p>
            ) : (
              <ul>
                {filtered.map((host) => (
                  <HostRow key={host.id} host={host} canEdit={canEdit} />
                ))}
              </ul>
            )}
          </Card>
          <p className="text-xs text-muted-foreground">
            {filtered.length} de {hosts.data?.length ?? 0} site{(hosts.data?.length ?? 0) === 1 ? "" : "s"}
          </p>
        </div>
      )}
    </>
  );
}
