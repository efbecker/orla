import { SearchX } from "lucide-react";
import { createBrowserRouter, Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { OrlaLogo } from "@/components/orla-logo";
import { EmptyState } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { LoginPage } from "@/features/auth/login-page";
import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { HostConfigPage } from "@/features/hosts/host-config-page";
import { HostCreatePage } from "@/features/hosts/host-create-page";
import { HostOriginPage } from "@/features/hosts/host-origin-page";
import { HostOverviewPage } from "@/features/hosts/host-overview-page";
import { HostRoute } from "@/features/hosts/host-route";
import { HostsPage } from "@/features/hosts/hosts-page";
import { UpstreamFormPage } from "@/features/upstreams/upstream-form-page";
import { UpstreamsPage } from "@/features/upstreams/upstreams-page";
import { useAuth } from "@/lib/auth";

function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center" aria-busy="true" aria-label="Carregando">
      <OrlaLogo className="h-10 w-10 animate-pulse" />
    </div>
  );
}

function RequireAuth() {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === "loading") return <SplashScreen />;
  if (state.status === "anonymous") return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  return <Outlet />;
}

function RequireEditor() {
  const { can } = useAuth();
  if (!can("EDITOR")) return <Navigate to="/" replace />;
  return <Outlet />;
}

function GuestOnly() {
  const { state } = useAuth();
  if (state.status === "loading") return <SplashScreen />;
  return <Outlet />;
}

function NotFoundPage() {
  return (
    <EmptyState
      icon={<SearchX />}
      title="Página não encontrada"
      description="O endereço não existe no painel."
      action={
        <Button asChild variant="outline">
          <Link to="/">Ir para a visão geral</Link>
        </Button>
      }
    />
  );
}

export const router = createBrowserRouter([
  {
    element: <GuestOnly />,
    children: [{ path: "/login", element: <LoginPage /> }],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: "/", element: <DashboardPage /> },
          { path: "/hosts", element: <HostsPage /> },
          {
            element: <RequireEditor />,
            children: [
              { path: "/hosts/new", element: <HostCreatePage /> },
              { path: "/upstreams/new", element: <UpstreamFormPage /> },
            ],
          },
          {
            path: "/hosts/:hostId",
            element: <HostRoute />,
            children: [
              { index: true, element: <HostOverviewPage /> },
              { path: "origin", element: <HostOriginPage /> },
              { path: "config", element: <HostConfigPage /> },
            ],
          },
          { path: "/upstreams", element: <UpstreamsPage /> },
          { path: "/upstreams/:poolId", element: <UpstreamFormPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
