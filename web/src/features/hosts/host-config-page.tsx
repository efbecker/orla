import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileCode2, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CodeView } from "@/components/code-view";
import { NginxErrorPanel } from "@/components/nginx-error";
import { PageHeader } from "@/components/page-header";
import { ErrorBlock } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ConfigPreviewDialog } from "@/features/hosts/config-preview-dialog";
import { useHostContext } from "@/features/hosts/host-route";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { queryKeys, useHostConfig } from "@/lib/queries";
import type { HostDetail } from "@/lib/types";

const MAX_DIRECTIVES = 16 * 1024;

function CustomDirectivesCard({ host }: { host: HostDetail }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(host.customDirectives ?? "");
  const [previewOpen, setPreviewOpen] = useState(false);
  const saved = host.customDirectives ?? "";
  const dirty = value !== saved;

  useEffect(() => {
    setValue(host.customDirectives ?? "");
  }, [host.customDirectives]);

  const save = useMutation({
    mutationFn: () => api<HostDetail>(`/hosts/${host.id}`, { method: "PATCH", body: { customDirectives: value.trim() ? value : null } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.host(host.id), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.hostConfig(host.id) });
      toast.success("Diretivas validadas pelo nginx -t e aplicadas.");
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-warning" /> Diretivas personalizadas
        </CardTitle>
        <CardDescription>
          Texto inserido no fim do bloco <code className="font-mono">server</code> que atende o site (fica de fora no modo de manutenção). Só
          administradores editam. O Orla confere
          as chaves e roda <code className="font-mono">nginx -t</code> antes de aplicar; se o Nginx recusar, nada muda.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={10}
          spellCheck={false}
          className="font-mono text-xs"
          placeholder={'location = /healthz {\n    return 200 "ok";\n}'}
          aria-label="Diretivas personalizadas"
          maxLength={MAX_DIRECTIVES}
        />
        <p className="text-xs text-muted-foreground">
          {value.length.toLocaleString("pt-BR")} de {MAX_DIRECTIVES.toLocaleString("pt-BR")} caracteres
        </p>
        {save.isError ? <NginxErrorPanel error={save.error} /> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={!dirty || save.isPending} onClick={() => setValue(saved)}>
            Descartar
          </Button>
          <Button variant="outline" disabled={!dirty} onClick={() => setPreviewOpen(true)}>
            <FileCode2 /> Visualizar .conf
          </Button>
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Validando com nginx -t..." : "Validar e aplicar"}
          </Button>
        </div>
      </CardContent>
      {previewOpen ? (
        <ConfigPreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          body={{ id: host.id, customDirectives: value.trim() ? value : null }}
          filename={`host-${host.id}.conf`}
        />
      ) : null}
    </Card>
  );
}

export function HostConfigPage() {
  const host = useHostContext();
  const config = useHostConfig(host.id);
  const { can } = useAuth();
  const failedLines =
    config.error instanceof ApiError ? config.error.diagnostics.flatMap((item) => (item.line ? [item.line] : [])) : [];

  return (
    <>
      <PageHeader
        title="Configuração Nginx"
        description={
          <>
            Arquivo <code className="font-mono">/etc/nginx/conf.d/host-{host.id}.conf</code> gerado a partir do banco. Não edite no servidor: ele é
            regravado a cada alteração.
          </>
        }
      />
      <div className="space-y-4">
        {config.isError ? (
          <ErrorBlock error={config.error} onRetry={() => void config.refetch()} />
        ) : config.isLoading || !config.data ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <CodeView code={config.data.config} filename={`host-${host.id}.conf`} highlightLines={failedLines} />
        )}
        {can("ADMIN") ? (
          <CustomDirectivesCard host={host} />
        ) : host.customDirectives ? (
          <p className="text-sm text-muted-foreground">Este site tem diretivas personalizadas definidas por um administrador.</p>
        ) : null}
      </div>
    </>
  );
}
