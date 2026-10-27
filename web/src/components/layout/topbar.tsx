import { ChevronsUpDown, Globe, KeyRound, LogOut, Menu, Monitor, Moon, Search, Sun } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useMatch, useNavigate } from "react-router-dom";
import { OrlaLogo } from "@/components/orla-logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChangePasswordDialog } from "@/features/auth/change-password-dialog";
import { useAuth } from "@/lib/auth";
import { useHosts } from "@/lib/queries";
import { useTheme, type ThemePreference } from "@/lib/theme";

const ROLE_LABELS = { ADMIN: "Administrador", EDITOR: "Editor", VIEWER: "Leitura" } as const;

function SiteSwitcher() {
  const hosts = useHosts();
  const navigate = useNavigate();
  const match = useMatch("/hosts/:hostId/*");
  const [filter, setFilter] = useState("");
  const current = hosts.data?.find((host) => String(host.id) === match?.params.hostId);
  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return (hosts.data ?? []).filter(
      (host) => !term || host.name.toLowerCase().includes(term) || host.domains.some((domain) => domain.domain.includes(term)),
    );
  }, [hosts.data, filter]);

  return (
    <DropdownMenu onOpenChange={(open) => !open && setFilter("")}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 max-w-[16rem] gap-2 px-2 text-topbar-foreground hover:bg-white/10 hover:text-topbar-foreground">
          <Globe className="h-4 w-4 opacity-70" />
          <span className="truncate">{current ? (current.domains[0]?.domain ?? current.name) : "Todos os sites"}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <div className="flex items-center gap-2 border-b px-2 pb-2 pt-1">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Buscar site"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            aria-label="Buscar site"
          />
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          <DropdownMenuItem onSelect={() => navigate("/hosts")}>Todos os sites</DropdownMenuItem>
          <DropdownMenuSeparator />
          {filtered.length === 0 ? <p className="px-2 py-3 text-center text-xs text-muted-foreground">Nenhum site encontrado.</p> : null}
          {filtered.map((host) => (
            <DropdownMenuItem key={host.id} onSelect={() => navigate(`/hosts/${host.id}`)}>
              <span className={host.enabled ? "h-2 w-2 rounded-full bg-success" : "h-2 w-2 rounded-full bg-muted-foreground/50"} />
              <span className="truncate">{host.domains[0]?.domain ?? host.name}</span>
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeMenu() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="text-topbar-foreground hover:bg-white/10 hover:text-topbar-foreground" aria-label="Tema">
          {resolved === "dark" ? <Moon /> : <Sun />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Tema</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={preference} onValueChange={(value) => setPreference(value as ThemePreference)}>
          <DropdownMenuRadioItem value="light">
            <Sun /> Claro
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon /> Escuro
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor /> Sistema
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [passwordOpen, setPasswordOpen] = useState(false);
  if (!user) return null;
  const initials = user.name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-9 gap-2 px-1.5 text-topbar-foreground hover:bg-white/10 hover:text-topbar-foreground" aria-label="Conta">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {initials || "?"}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="font-normal">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            <p className="mt-1 text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setPasswordOpen(true)}>
            <KeyRound /> Alterar senha
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void logout()}>
            <LogOut /> Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </>
  );
}

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 bg-topbar px-3 text-topbar-foreground shadow-sm sm:px-4">
      <Button
        variant="ghost"
        size="icon"
        className="text-topbar-foreground hover:bg-white/10 hover:text-topbar-foreground lg:hidden"
        onClick={onOpenMenu}
        aria-label="Abrir menu"
      >
        <Menu />
      </Button>
      <Link to="/" className="mr-2 flex items-center gap-2">
        <OrlaLogo className="h-7 w-7" />
        <span className="hidden text-base font-semibold sm:inline">Orla</span>
      </Link>
      <SiteSwitcher />
      <div className="ml-auto flex items-center gap-1">
        <ThemeMenu />
        <UserMenu />
      </div>
    </header>
  );
}
