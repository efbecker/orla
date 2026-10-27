import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Boxes, Pencil, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorBlock, LoadingBlock } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ALGORITHM_LABELS } from "@/features/hosts/labels";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { queryKeys, usePools } from "@/lib/queries";
import type { UpstreamPool, UpstreamServer } from "@/lib/types";

function ServerToggle({ pool, server, canEdit }: { pool: UpstreamPool; server: UpstreamServer; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (isDown: boolean) => api(`/upstream-pools/${pool.id}/servers/${server.id}`, { method: "PATCH", body: { isDown } }),
    onSuccess: (_data, isDown) => {
      toast.success(`${server.address}:${server.port} ${isDown ? "retirado do balanceamento" : "de volta ao balanceamento"}.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.pools });
      void queryClient.invalidateQueries({ queryKey: queryKeys.hosts });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const active = mutation.isPending ? !mutation.variables : !server.isDown;
  const onlyActive = !server.isDown && pool.servers.filter((item) => !item.isDown).length === 1;
  return (
    <Switch
      checked={active}
      disabled={!canEdit || mutation.isPending || onlyActive}
      onCheckedChange={(checked) => mutation.mutate(!checked)}
      aria-label={`${active ? "Retirar" : "Recolocar"} ${server.address}:${server.port}`}
      title={onlyActive ? "O pool precisa de ao menos um servidor ativo." : undefined}
    />
  );
}

function PoolCard({ pool, canEdit }: { pool: UpstreamPool; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const inUse = pool._count.hosts + pool._count.locations;
  const remove = useMutation({
    mutationFn: () => api(`/upstream-pools/${pool.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(`Pool ${pool.name} excluído.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.pools });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/upstreams/${pool.id}`} className="truncate font-semibold hover:text-primary">
              {pool.name}
            </Link>
            <Badge variant="secondary">{pool.scheme.toLowerCase()}://</Badge>
            <Badge variant="outline">{ALGORITHM_LABELS[pool.algorithm]}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {pool.description ? `${pool.description} · ` : ""}
            {inUse === 0
              ? "Não está em uso"
              : `Usado por ${pool._count.hosts} site${pool._count.hosts === 1 ? "" : "s"}${pool._count.locations ? ` e ${pool._count.locations} rota(s)` : ""}`}
          </p>
        </div>
        {canEdit ? (
          <div className="flex gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link to={`/upstreams/${pool.id}`}>
                <Pencil /> Editar
              </Link>
            </Button>
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="sm" disabled={inUse > 0} title={inUse > 0 ? "Remova o pool dos sites antes de excluir." : undefined}>
                  <Trash2 /> Excluir
                </Button>
              }
              title={`Excluir o pool ${pool.name}?`}
              description="Os servidores cadastrados nele também serão removidos."
              confirmLabel="Excluir pool"
              pending={remove.isPending}
              onConfirm={() => remove.mutateAsync()}
            />
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Servidor</TableHead>
              <TableHead className="hidden sm:table-cell">Peso</TableHead>
              <TableHead className="hidden md:table-cell">Falhas / janela</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead className="text-right">Ativo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pool.servers.map((server) => (
              <TableRow key={server.id} className={server.isDown ? "opacity-60" : undefined}>
                <TableCell className="font-mono text-xs">
                  {server.address}:{server.port}
                </TableCell>
                <TableCell className="hidden tabular sm:table-cell">{server.weight}</TableCell>
                <TableCell className="hidden tabular text-muted-foreground md:table-cell">
                  {server.maxFails} em {server.failTimeoutSeconds}s
                </TableCell>
                <TableCell>{server.isBackup ? <Badge variant="warning">Backup</Badge> : <Badge variant="secondary">Principal</Badge>}</TableCell>
                <TableCell className="text-right">
                  <ServerToggle pool={pool} server={server} canEdit={canEdit} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function UpstreamsPage() {
  const pools = usePools();
  const { can } = useAuth();
  const canEdit = can("EDITOR");
  const addButton = canEdit ? (
    <Button asChild>
      <Link to="/upstreams/new">
        <Plus /> Criar pool
      </Link>
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title="Upstreams"
        description="Grupos de servidores de origem com balanceamento de carga e failover. Um site usa um pool como origem."
        actions={addButton}
      />
      {pools.isLoading ? (
        <LoadingBlock rows={3} />
      ) : pools.isError ? (
        <ErrorBlock error={pools.error} onRetry={() => void pools.refetch()} />
      ) : (pools.data ?? []).length === 0 ? (
        <EmptyState
          icon={<Boxes />}
          title="Nenhum pool cadastrado"
          description="Crie um pool para distribuir o tráfego entre vários servidores. Sites com uma origem só ganham um pool automático."
          action={addButton}
        />
      ) : (
        <div className="space-y-4">
          {pools.data?.map((pool) => (
            <PoolCard key={pool.id} pool={pool} canEdit={canEdit} />
          ))}
        </div>
      )}
    </>
  );
}
