import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileCode2 } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { FormField } from "@/components/form-field";
import { NginxErrorPanel } from "@/components/nginx-error";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ConfigPreviewDialog } from "@/features/hosts/config-preview-dialog";
import { DomainsInput } from "@/features/hosts/domains-input";
import { OriginFields, originToApi, validateOrigin, type OriginValue } from "@/features/hosts/origin-fields";
import { ApiError, api } from "@/lib/api";
import { applyServerIssues } from "@/lib/form-errors";
import { queryKeys, usePools } from "@/lib/queries";
import type { HostDetail } from "@/lib/types";

const originSchema = z.object({
  mode: z.enum(["server", "pool", "none"]),
  scheme: z.enum(["HTTP", "HTTPS"]),
  address: z.string(),
  port: z.string(),
  poolId: z.string(),
});

const schema = z
  .object({
    domains: z.array(z.string()).min(1, "Informe ao menos um domínio."),
    name: z.string().trim().max(120, "Use até 120 caracteres."),
    origin: originSchema,
    websocketEnabled: z.boolean(),
    cacheEnabled: z.boolean(),
    edgeProtectionEnabled: z.boolean(),
  })
  .superRefine((value, ctx) => {
    for (const [field, message] of Object.entries(validateOrigin(value.origin))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["origin", field], message });
    }
  });

type Values = z.infer<typeof schema>;

const OPTIONS: Array<{ name: "edgeProtectionEnabled" | "websocketEnabled" | "cacheEnabled"; title: string; description: string }> = [
  {
    name: "edgeProtectionEnabled",
    title: "Proteção de borda",
    description: "Limite global de requisições e conexões por IP, cabeçalhos e bloqueios de segurança configurados no site.",
  },
  { name: "websocketEnabled", title: "WebSockets", description: "Permite conexões WebSocket (Upgrade) até a origem." },
  { name: "cacheEnabled", title: "Cache", description: "Guarda arquivos estáticos (CSS, JS, imagens, fontes) na borda." },
];

function toApi(values: Values): Record<string, unknown> {
  return {
    name: values.name.trim() || values.domains[0],
    domains: values.domains,
    websocketEnabled: values.websocketEnabled,
    cacheEnabled: values.cacheEnabled,
    edgeProtectionEnabled: values.edgeProtectionEnabled,
    ...originToApi(values.origin as OriginValue),
  };
}

export function HostCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pools = usePools();
  const [previewOpen, setPreviewOpen] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      domains: [],
      name: "",
      origin: { mode: "server", scheme: "HTTP", address: "", port: "", poolId: "" },
      websocketEnabled: false,
      cacheEnabled: false,
      edgeProtectionEnabled: true,
    },
  });
  const { errors } = form.formState;
  const domains = form.watch("domains");

  const create = useMutation({
    mutationFn: (values: Values) => api<HostDetail>("/hosts", { method: "POST", body: toApi(values) }),
    onSuccess: (host) => {
      queryClient.setQueryData(queryKeys.host(host.id), host);
      void queryClient.invalidateQueries({ queryKey: queryKeys.hosts });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pools });
      toast.success(`Site ${host.domains[0]?.domain ?? host.name} criado e aplicado no Nginx.`);
      navigate(`/hosts/${host.id}`);
    },
    onError: (error) => {
      applyServerIssues(error, form.setError, (path) => {
        if (path.startsWith("domains")) return "domains";
        if (path === "name") return "name";
        if (path === "upstream.address") return "origin.address";
        if (path === "upstream.port") return "origin.port";
        return null;
      });
      if (error instanceof ApiError && error.status === 409) form.setError("domains", { type: "server", message: error.message });
    },
  });

  const showPanel = create.isError && !(create.error instanceof ApiError && (create.error.status === 409 || create.error.issues.length > 0));

  return (
    <>
      <Link to="/hosts" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Sites
      </Link>
      <PageHeader
        title="Adicionar site"
        description="Aponte o DNS (registro A/AAAA) dos domínios para este servidor. O Orla gera a configuração, testa com nginx -t e só então recarrega."
      />
      <form className="space-y-4" onSubmit={form.handleSubmit((values) => create.mutate(values))} noValidate>
        <Card>
          <CardHeader>
            <CardTitle>Domínios</CardTitle>
            <CardDescription>O primeiro é o domínio principal. Use *.exemplo.com para um curinga.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField id="domains" label="Domínios" hint="Pressione Enter, espaço ou vírgula para adicionar." error={errors.domains?.message}>
              <Controller
                control={form.control}
                name="domains"
                render={({ field }) => <DomainsInput id="domains" value={field.value} onChange={field.onChange} invalid={!!errors.domains} />}
              />
            </FormField>
            <FormField id="name" label="Nome de exibição" hint="Opcional. Se ficar em branco, usa o domínio principal." error={errors.name?.message}>
              <Input id="name" placeholder={domains[0] ?? "Loja virtual"} aria-invalid={!!errors.name} {...form.register("name")} />
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Origem</CardTitle>
            <CardDescription>Para onde o Nginx encaminha as requisições.</CardDescription>
          </CardHeader>
          <CardContent>
            <Controller
              control={form.control}
              name="origin"
              render={({ field }) => (
                <OriginFields
                  value={field.value as OriginValue}
                  onChange={field.onChange}
                  errors={{ address: errors.origin?.address?.message, port: errors.origin?.port?.message, poolId: errors.origin?.poolId?.message }}
                  pools={pools.data ?? []}
                />
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Opções iniciais</CardTitle>
            <CardDescription>Tudo pode ser alterado depois. O SSL é configurado na página do site.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {OPTIONS.map((option) => (
              <label key={option.name} htmlFor={option.name} className="flex cursor-pointer items-start justify-between gap-4 px-5 py-4">
                <span>
                  <span className="block text-sm font-medium">{option.title}</span>
                  <span className="block text-sm text-muted-foreground">{option.description}</span>
                </span>
                <Controller
                  control={form.control}
                  name={option.name}
                  render={({ field }) => <Switch id={option.name} checked={field.value} onCheckedChange={field.onChange} />}
                />
              </label>
            ))}
          </CardContent>
        </Card>

        {showPanel ? <NginxErrorPanel error={create.error} /> : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              if (await form.trigger()) setPreviewOpen(true);
            }}
          >
            <FileCode2 /> Visualizar .conf
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Aplicando no Nginx..." : "Criar site"}
          </Button>
        </div>
      </form>
      {previewOpen ? (
        <ConfigPreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} body={toApi(form.getValues())} filename="host-novo.conf" />
      ) : null}
    </>
  );
}
