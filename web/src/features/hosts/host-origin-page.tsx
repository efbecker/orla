import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileCode2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormField } from "@/components/form-field";
import { NginxErrorPanel } from "@/components/nginx-error";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConfigPreviewDialog } from "@/features/hosts/config-preview-dialog";
import { DomainsInput } from "@/features/hosts/domains-input";
import { useHostContext } from "@/features/hosts/host-route";
import { primaryDomain } from "@/features/hosts/labels";
import { OriginFields, originToApi, validateOrigin, type OriginValue } from "@/features/hosts/origin-fields";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { applyServerIssues } from "@/lib/form-errors";
import { queryKeys, usePools, useSystemInfo } from "@/lib/queries";
import type { HostDetail } from "@/lib/types";

const intField = (label: string, min: number, max: number) =>
  z
    .number({ invalid_type_error: `Informe ${label}.` })
    .int(`Use um número inteiro.`)
    .min(min, `Mínimo ${min}.`)
    .max(max, `Máximo ${max.toLocaleString("pt-BR")}.`);

const schema = z
  .object({
    name: z.string().trim().min(1, "Informe um nome.").max(120, "Use até 120 caracteres."),
    description: z.string().trim().max(500, "Use até 500 caracteres."),
    domains: z.array(z.string()).min(1, "Informe ao menos um domínio."),
    origin: z.object({
      mode: z.enum(["server", "pool", "none"]),
      scheme: z.enum(["HTTP", "HTTPS"]),
      address: z.string(),
      port: z.string(),
      poolId: z.string(),
    }),
    proxyConnectTimeoutSeconds: intField("o tempo", 1, 86_400),
    proxyReadTimeoutSeconds: intField("o tempo", 1, 86_400),
    proxySendTimeoutSeconds: intField("o tempo", 1, 86_400),
    clientMaxBodySizeMb: intField("o tamanho", 0, 102_400),
    proxyBufferingEnabled: z.boolean(),
    gzipEnabled: z.boolean(),
    brotliEnabled: z.boolean(),
    maintenanceTitle: z.string().trim().max(200, "Use até 200 caracteres."),
    maintenanceMessage: z.string().trim().max(2000, "Use até 2000 caracteres."),
  })
  .superRefine((value, ctx) => {
    for (const [field, message] of Object.entries(validateOrigin(value.origin))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["origin", field], message });
    }
  });

type Values = z.infer<typeof schema>;

/** A pool used only by this host with one server is edited as a plain "origin server". */
function initialOrigin(host: HostDetail): OriginValue {
  const pool = host.upstreamPool;
  const only = pool?.servers[0];
  if (pool && only && pool.servers.length === 1 && pool._count.hosts === 1 && pool._count.locations === 0) {
    return { mode: "server", scheme: pool.scheme, address: only.address, port: String(only.port), poolId: String(pool.id) };
  }
  if (pool) return { mode: "pool", scheme: "HTTP", address: "", port: "", poolId: String(pool.id) };
  return { mode: "none", scheme: "HTTP", address: "", port: "", poolId: "" };
}

function toValues(host: HostDetail): Values {
  return {
    name: host.name,
    description: host.description ?? "",
    domains: host.domains.map((domain) => domain.domain),
    origin: initialOrigin(host),
    proxyConnectTimeoutSeconds: host.proxyConnectTimeoutSeconds,
    proxyReadTimeoutSeconds: host.proxyReadTimeoutSeconds,
    proxySendTimeoutSeconds: host.proxySendTimeoutSeconds,
    clientMaxBodySizeMb: host.clientMaxBodySizeMb,
    proxyBufferingEnabled: host.proxyBufferingEnabled,
    gzipEnabled: host.gzipEnabled,
    brotliEnabled: host.brotliEnabled,
    maintenanceTitle: host.maintenanceTitle ?? "",
    maintenanceMessage: host.maintenanceMessage ?? "",
  };
}

/** Only the fields the user changed go to PATCH /hosts/:id. */
function changedFields(values: Values, initial: Values): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const simple = [
    "name",
    "proxyConnectTimeoutSeconds",
    "proxyReadTimeoutSeconds",
    "proxySendTimeoutSeconds",
    "clientMaxBodySizeMb",
    "proxyBufferingEnabled",
    "gzipEnabled",
    "brotliEnabled",
  ] as const;
  for (const key of simple) if (values[key] !== initial[key]) body[key] = values[key];
  for (const key of ["description", "maintenanceTitle", "maintenanceMessage"] as const) {
    if (values[key] !== initial[key]) body[key] = values[key] || null;
  }
  if (values.domains.join("\n") !== initial.domains.join("\n")) body.domains = values.domains;
  if (JSON.stringify(values.origin) !== JSON.stringify(initial.origin)) Object.assign(body, originToApi(values.origin as OriginValue));
  return body;
}

function Toggle({ id, title, description, checked, onChange, disabled }: { id: string; title: string; description: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start justify-between gap-4 py-3">
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  );
}

export function HostOriginPage() {
  const host = useHostContext();
  const { can } = useAuth();
  const canEdit = can("EDITOR");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pools = usePools();
  const info = useSystemInfo();
  const [previewOpen, setPreviewOpen] = useState(false);
  const initial = useMemo(() => toValues(host), [host]);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: initial });
  const { errors, isDirty } = form.formState;
  const domain = primaryDomain(host);

  useEffect(() => {
    form.reset(initial);
  }, [initial, form]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<HostDetail>(`/hosts/${host.id}`, { method: "PATCH", body }),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.host(host.id), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.hosts });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pools });
      toast.success("Alterações aplicadas no Nginx.");
    },
    onError: (error) => {
      applyServerIssues(error, form.setError, (path) => {
        if (path.startsWith("domains")) return "domains";
        if (path === "upstream.address") return "origin.address";
        if (path === "upstream.port") return "origin.port";
        if (path in initial) return path as keyof Values;
        return null;
      });
      if (error instanceof ApiError && error.status === 409 && error.message.includes("domínio")) {
        form.setError("domains", { type: "server", message: error.message });
      }
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/hosts/${host.id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.host(host.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.hosts });
      toast.success(`Site ${domain} excluído.`);
      navigate("/hosts");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const submit = form.handleSubmit((values) => {
    const body = changedFields(values, initial);
    if (Object.keys(body).length === 0) {
      toast.info("Nenhuma alteração para salvar.");
      return;
    }
    save.mutate(body);
  });

  const showPanel = save.isError && !(save.error instanceof ApiError && (save.error.issues.length > 0 || save.error.status === 409));

  return (
    <>
      <PageHeader title="Origem e desempenho" description={`Domínios, servidor de origem e limites de ${domain}.`} />
      <form className="space-y-4" onSubmit={submit} noValidate>
        <fieldset disabled={!canEdit} className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Identificação</CardTitle>
              <CardDescription>O primeiro domínio é o principal.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField id="domains" label="Domínios" hint="Pressione Enter, espaço ou vírgula para adicionar." error={errors.domains?.message}>
                <Controller
                  control={form.control}
                  name="domains"
                  render={({ field }) => <DomainsInput id="domains" value={field.value} onChange={field.onChange} invalid={!!errors.domains} disabled={!canEdit} />}
                />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="name" label="Nome de exibição" error={errors.name?.message}>
                  <Input id="name" aria-invalid={!!errors.name} {...form.register("name")} />
                </FormField>
                <FormField id="description" label="Descrição" hint="Opcional, só aparece no painel." error={errors.description?.message}>
                  <Input id="description" aria-invalid={!!errors.description} {...form.register("description")} />
                </FormField>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Origem</CardTitle>
              <CardDescription>Para onde o Nginx encaminha as requisições deste site.</CardDescription>
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
                    disabled={!canEdit}
                  />
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Desempenho</CardTitle>
              <CardDescription>Compressão, buffers e limites de tempo da conexão com a origem.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <FormField id="clientMaxBodySizeMb" label="Tamanho máximo do upload (MB)" hint="0 = sem limite." error={errors.clientMaxBodySizeMb?.message}>
                  <Input id="clientMaxBodySizeMb" type="number" min={0} aria-invalid={!!errors.clientMaxBodySizeMb} {...form.register("clientMaxBodySizeMb", { valueAsNumber: true })} />
                </FormField>
                <FormField id="proxyConnectTimeoutSeconds" label="Conexão com a origem (s)" error={errors.proxyConnectTimeoutSeconds?.message}>
                  <Input id="proxyConnectTimeoutSeconds" type="number" min={1} aria-invalid={!!errors.proxyConnectTimeoutSeconds} {...form.register("proxyConnectTimeoutSeconds", { valueAsNumber: true })} />
                </FormField>
                <FormField id="proxyReadTimeoutSeconds" label="Leitura da resposta (s)" error={errors.proxyReadTimeoutSeconds?.message}>
                  <Input id="proxyReadTimeoutSeconds" type="number" min={1} aria-invalid={!!errors.proxyReadTimeoutSeconds} {...form.register("proxyReadTimeoutSeconds", { valueAsNumber: true })} />
                </FormField>
                <FormField id="proxySendTimeoutSeconds" label="Envio da requisição (s)" error={errors.proxySendTimeoutSeconds?.message}>
                  <Input id="proxySendTimeoutSeconds" type="number" min={1} aria-invalid={!!errors.proxySendTimeoutSeconds} {...form.register("proxySendTimeoutSeconds", { valueAsNumber: true })} />
                </FormField>
              </div>
              <div className="mt-2 divide-y">
                <Controller
                  control={form.control}
                  name="gzipEnabled"
                  render={({ field }) => (
                    <Toggle id="gzipEnabled" title="Gzip" description="Comprime respostas de texto (HTML, CSS, JS, JSON)." checked={field.value} onChange={field.onChange} disabled={!canEdit} />
                  )}
                />
                <Controller
                  control={form.control}
                  name="brotliEnabled"
                  render={({ field }) => (
                    <Toggle
                      id="brotliEnabled"
                      title="Brotli"
                      description={info.data?.capabilities.brotli === false ? "O Nginx deste servidor não tem o módulo Brotli." : "Compressão Brotli, menor que gzip, para navegadores que aceitam."}
                      checked={field.value}
                      onChange={field.onChange}
                      disabled={!canEdit || (info.data?.capabilities.brotli === false && !field.value)}
                    />
                  )}
                />
                <Controller
                  control={form.control}
                  name="proxyBufferingEnabled"
                  render={({ field }) => (
                    <Toggle
                      id="proxyBufferingEnabled"
                      title="Buffer de respostas"
                      description="Desligue para streaming e Server-Sent Events, em que a resposta precisa chegar aos poucos."
                      checked={field.value}
                      onChange={field.onChange}
                      disabled={!canEdit}
                    />
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Página de manutenção</CardTitle>
              <CardDescription>Texto mostrado quando o modo de manutenção estiver ligado (em Visão geral).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField id="maintenanceTitle" label="Título" error={errors.maintenanceTitle?.message}>
                <Input id="maintenanceTitle" placeholder="Voltamos em instantes" aria-invalid={!!errors.maintenanceTitle} {...form.register("maintenanceTitle")} />
              </FormField>
              <FormField id="maintenanceMessage" label="Mensagem" error={errors.maintenanceMessage?.message}>
                <Textarea
                  id="maintenanceMessage"
                  rows={3}
                  placeholder="Estamos fazendo uma manutenção programada. Tente de novo em alguns minutos."
                  aria-invalid={!!errors.maintenanceMessage}
                  {...form.register("maintenanceMessage")}
                />
              </FormField>
            </CardContent>
          </Card>
        </fieldset>

        {showPanel ? <NginxErrorPanel error={save.error} /> : null}

        {canEdit ? (
          <div className="sticky bottom-0 z-10 -mx-4 flex flex-col-reverse gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:justify-end sm:rounded-lg sm:border">
            {isDirty ? <p className="mr-auto self-center text-sm text-muted-foreground">Há alterações não salvas.</p> : null}
            <Button type="button" variant="ghost" disabled={!isDirty || save.isPending} onClick={() => form.reset(initial)}>
              Descartar
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                if (await form.trigger()) setPreviewOpen(true);
              }}
            >
              <FileCode2 /> Visualizar .conf
            </Button>
            <Button type="submit" disabled={!isDirty || save.isPending}>
              {save.isPending ? "Aplicando no Nginx..." : "Salvar"}
            </Button>
          </div>
        ) : null}
      </form>

      {canEdit ? (
        <Card className="mt-8 border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Excluir site</CardTitle>
            <CardDescription>
              Remove o site, as rotas e as regras dele. O Nginx deixa de atender {domain} na hora. Pools de upstream e certificados continuam cadastrados.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConfirmDialog
              trigger={
                <Button variant="destructive">
                  <Trash2 /> Excluir site
                </Button>
              }
              title={`Excluir ${domain}?`}
              description="Esta ação não pode ser desfeita."
              confirmLabel="Excluir site"
              confirmText={domain}
              pending={remove.isPending}
              onConfirm={() => remove.mutateAsync()}
            />
          </CardContent>
        </Card>
      ) : null}

      {previewOpen ? (
        <ConfigPreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          body={{ id: host.id, ...changedFields(form.getValues(), initial) }}
          filename={`host-${host.id}.conf`}
        />
      ) : null}
    </>
  );
}
