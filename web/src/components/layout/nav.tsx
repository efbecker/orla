import { ArrowLeft, Boxes, FileCode2, Gauge, Globe, LayoutDashboard, Server, type LucideIcon } from "lucide-react";
import { NavLink, useMatch } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useHost } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const ACCOUNT_ITEMS: NavItem[] = [
  { to: "/", label: "Visão geral", icon: LayoutDashboard, end: true },
  { to: "/hosts", label: "Sites", icon: Globe },
  { to: "/upstreams", label: "Upstreams", icon: Boxes },
];

function hostItems(id: number): NavItem[] {
  return [
    { to: `/hosts/${id}`, label: "Visão geral", icon: Gauge, end: true },
    { to: `/hosts/${id}/origin`, label: "Origem e desempenho", icon: Server },
    { to: `/hosts/${id}/config`, label: "Configuração Nginx", icon: FileCode2 },
  ];
}

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive ? "bg-accent text-accent-foreground" : "text-sidebar-foreground hover:bg-secondary",
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function HostNav({ hostId, onNavigate }: { hostId: number; onNavigate?: () => void }) {
  const host = useHost(hostId);
  const primary = host.data?.domains[0]?.domain ?? host.data?.name;
  return (
    <div className="space-y-4">
      <NavLink
        to="/hosts"
        onClick={onNavigate}
        className="flex items-center gap-2 px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Todos os sites
      </NavLink>
      <div className="px-3">
        {host.isLoading ? (
          <Skeleton className="h-5 w-40" />
        ) : (
          <>
            <p className="truncate text-sm font-semibold" title={primary}>
              {primary ?? "Site não encontrado"}
            </p>
            {host.data ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {host.data.enabled ? <Badge variant="success">Ativo</Badge> : <Badge variant="secondary">Desativado</Badge>}
                {host.data.maintenanceEnabled ? <Badge variant="warning">Manutenção</Badge> : null}
              </div>
            ) : null}
          </>
        )}
      </div>
      <NavList items={hostItems(hostId)} onNavigate={onNavigate} />
    </div>
  );
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const match = useMatch("/hosts/:hostId/*");
  const hostId = Number(match?.params.hostId);
  return (
    <nav className="p-3" aria-label="Navegação principal">
      {Number.isInteger(hostId) && hostId > 0 ? (
        <HostNav hostId={hostId} onNavigate={onNavigate} />
      ) : (
        <>
          <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conta</p>
          <NavList items={ACCOUNT_ITEMS} onNavigate={onNavigate} />
        </>
      )}
    </nav>
  );
}
