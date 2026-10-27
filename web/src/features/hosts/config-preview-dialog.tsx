import { useQuery } from "@tanstack/react-query";
import { NginxErrorPanel } from "@/components/nginx-error";
import { CodeView } from "@/components/code-view";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

/** Renders the .conf a pending change would produce (POST /hosts/preview, nothing is saved). */
export function ConfigPreviewDialog({
  open,
  onOpenChange,
  body,
  filename,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  body: Record<string, unknown>;
  filename: string;
}) {
  const preview = useQuery({
    queryKey: ["hosts", "preview", body],
    queryFn: () => api<{ config: string }>("/hosts/preview", { method: "POST", body }),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Visualizar .conf</DialogTitle>
          <DialogDescription>Configuração que o Orla vai gerar com as alterações do formulário. Nada foi salvo ainda.</DialogDescription>
        </DialogHeader>
        {preview.isError ? (
          <NginxErrorPanel error={preview.error} />
        ) : preview.isLoading || !preview.data ? (
          <Skeleton className="h-96 w-full" />
        ) : preview.data.config ? (
          <CodeView code={preview.data.config} filename={filename} />
        ) : (
          <p className="text-sm text-muted-foreground">Informe ao menos um domínio para gerar a configuração.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
