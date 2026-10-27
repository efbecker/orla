import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { FormField } from "@/components/form-field";
import { NginxErrorPanel } from "@/components/nginx-error";
import { PageHeader } from "@/components/page-header";
import { ErrorBlock, LoadingBlock } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ALGORITHM_LABELS } from "@/features/hosts/labels";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { applyServerIssues } from "@/lib/form-errors";
import { queryKeys } from "@/lib/queries";
import type { LoadBalancingAlgorithm, UpstreamPool } from "@/lib/types";

const serverSchema = z.object({
  address: z
    .string()
    .trim()
    .min(1, "Informe o endereço.")
    .refine((value) => !/[\s;{}"'$\\]/.test(value) && !/^[a-z]+:\/\//i.test(value), "Só host ou IP, sem http://."),
  port: z.number({ invalid_type_error: "Porta?" }).int().min(1, "1 a 65535").max(65535, "1 a 65535"),
  weight: z.number({ invalid_type_error: "Peso?" }).int().min(1, "1 a 1000").max(1000, "1 a 1000"),
  maxFails: z.number({ invalid_type_error: "Valor?" }).int().min(0, "0 a 100").max(100, "0 a 100"),
  failTimeoutSeconds: z.number({ invalid_type_error: "Valor?" }).int().min(1, "1 a 3600").max(3600, "1 a 3600"),
  isBackup: z.boolean(),
  isDown: z.boolean(),
});

const schema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Informe um nome.")
      .max(120, "Use até 120 caracteres.")
      .regex(/^[\w.\- ]+$/, "Use letras, números, espaços, ponto, hífen ou sublinhado."),
    description: z.string().trim().max(500, "Use até 500 caracteres."),
    scheme: z.enum(["HTTP", "HTTPS"]),
    algorithm: z.enum(["ROUND_ROBIN", "LEAST_CONN", "IP_HASH"]),
    keepaliveConnections: z.number({ invalid_type_error: "Informe um número." }).int().min(0, "Mínimo 0.").max(1024, "Máximo 1024."),
    servers: z.array(serverSchema).min(1, "Cadastre ao menos um servidor.").max(100),
  })
  .superRefine((value, ctx) => {
    if (value.algorithm === "IP_HASH") {
      value.servers.forEach((server, index) => {
        if (server.isBackup) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["servers", index, "isBackup"], message: "IP hash não aceita backup." });
      });
    }
    const seen = new Set<string>();
    value.servers.forEach((server, index) => {
      const key = `${server.address.trim()}:${server.port}`;
      if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["servers", index, "address"], message: "Servidor repetido." });
      seen.add(key);
    });
    if (value.servers.length > 0 && value.servers.every((server) => server.isDown || server.isBackup)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["servers"], message: "Mantenha ao menos um servidor principal ativo." });
    }
  });

type Values = z.infer<typeof schema>;

const EMPTY_SERVER: Values["servers"][number] = { address: "", port: 80, weight: 1, maxFails: 3, failTimeoutSeconds: 10, isBackup: false, isDown: false };

function toValues(pool?: UpstreamPool): Values {
  if (!pool) {
    return { name: "", description: "", scheme: "HTTP", algorithm: "ROUND_ROBIN", keepaliveConnections: 32, servers: [{ ...EMPTY_SERVER }] };
  }
  return {
    name: pool.name,
    description: pool.description ?? "",
    scheme: pool.scheme,
    algorithm: pool.algorithm,
    keepaliveConnections: pool.keepaliveConnections,
    servers: pool.servers.map((server) => ({
      address: server.address,
      port: server.port,
      weight: server.weight,
      maxFails: server.maxFails,
      failTimeoutSeconds: server.failTimeoutSeconds,
      isBackup: server.isBackup,
      isDown: server.isDown,
    })),
  };
}

function toApi(values: Values) {
  return {
    ...values,
    description: values.description || null,
    servers: values.servers.map((server, index) => ({ ...server, address: server.address.trim(), sortOrder: index })),
  };
}

const ALGORITHM_HINTS: Record<LoadBalancingAlgorithm, string> = {
  ROUND_ROBIN: "Distribui as requisições em sequência, respeitando o peso.",
  LEAST_CONN: "Envia para o servidor com menos conexões abertas.",
  IP_HASH: "O mesmo visitante vai sempre para o mesmo servidor.",
};

export function UpstreamFormPage() {
  const { poolId } = useParams();
  const isNew = poolId === undefined;
  const id = Number(poolId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canEdit = can("EDITOR");

  const existing = useQuery({
    queryKey: [...queryKeys.pools, id],
    queryFn: () => api<UpstreamPool>(`/upstream-pools/${id}`),
    enabled: !isNew && Number.isInteger(id),
  });

  const initial = useMemo(() => toValues(existing.data), [existing.data]);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: initial });
  const servers = useFieldArray({ control: form.control, name: "servers" });
  const { errors, isDirty } = form.formState;
  const algorithm = form.watch("algorithm");

  useEffect(() => {
    form.reset(initial);
  }, [initial, form]);

  const save = useMutation({
    mutationFn: (values: Values) =>
      isNew
        ? api<UpstreamPool>("/upstream-pools", { method: "POST", body: toApi(values) })
        : api<UpstreamPool>(`/upstream-pools/${id}`, { method: "PUT", body: toApi(values) }),
    onSuccess: (pool) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pools });
      void queryClient.invalidateQueries({ queryKey: queryKeys.hosts });
      toast.success(isNew ? `Pool ${pool.name} criado.` : `Pool ${pool.name} atualizado e aplicado no Nginx.`);
      navigate("/upstreams");
    },
    onError: (error) => {
      applyServerIssues(error, form.setError, (path) => {
        if (path === "name" || path === "algorithm" || path === "keepaliveConnections" || path === "description") return path;
        const match = /^servers\.(\d+)(?:\.(\w+))?$/.exec(path);
        if (match) return `servers.${Number(match[1])}.${match[2] ?? "address"}` as `servers.${number}.address`;
        return null;
      });
      if (error instanceof ApiError && error.status === 409) form.setError("name", { type: "server", message: error.message });
    },
  });

  if (!isNew && existing.isLoading) return <LoadingBlock rows={3} />;
  if (!isNew && existing.isError) return <ErrorBlock error={existing.error} onRetry={() => void existing.refetch()} />;

  const showPanel = save.isError && !(save.error instanceof ApiError && (save.error.issues.length > 0 || save.error.status === 409));

  return (
    <>
      <Link to="/upstreams" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Upstreams
      </Link>
      <PageHeader
        title={isNew ? "Criar pool" : `Pool ${existing.data?.name ?? ""}`}
        description={
          !isNew && existing.data && existing.data._count.hosts + existing.data._count.locations > 0
            ? `Alterações valem na hora para os ${existing.data._count.hosts} site(s) que usam este pool.`
            : "Servidores que recebem o tráfego e a forma de distribuir as requisições."
        }
      />
      <form className="space-y-4" onSubmit={form.handleSubmit((values) => save.mutate(values))} noValidate>
        <fieldset disabled={!canEdit} className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Pool</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FormField id="name" label="Nome" error={errors.name?.message}>
                <Input id="name" placeholder="app-backend" aria-invalid={!!errors.name} {...form.register("name")} />
              </FormField>
              <FormField id="description" label="Descrição" hint="Opcional." error={errors.description?.message}>
                <Input id="description" aria-invalid={!!errors.description} {...form.register("description")} />
              </FormField>
              <FormField id="scheme" label="Protocolo até os servidores" hint="Com SSL Completo, o site sempre usa https.">
                <Controller
                  control={form.control}
                  name="scheme"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={!canEdit}>
                      <SelectTrigger id="scheme">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="HTTP">http://</SelectItem>
                        <SelectItem value="HTTPS">https://</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>
              <FormField id="algorithm" label="Balanceamento" hint={ALGORITHM_HINTS[algorithm]} error={errors.algorithm?.message}>
                <Controller
                  control={form.control}
                  name="algorithm"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={!canEdit}>
                      <SelectTrigger id="algorithm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(ALGORITHM_LABELS) as LoadBalancingAlgorithm[]).map((value) => (
                          <SelectItem key={value} value={value}>
                            {ALGORITHM_LABELS[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>
              <FormField
                id="keepaliveConnections"
                label="Conexões keepalive"
                hint="Conexões ociosas mantidas abertas com a origem, por worker. 0 desliga."
                error={errors.keepaliveConnections?.message}
              >
                <Input
                  id="keepaliveConnections"
                  type="number"
                  min={0}
                  aria-invalid={!!errors.keepaliveConnections}
                  {...form.register("keepaliveConnections", { valueAsNumber: true })}
                />
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Servidores</CardTitle>
              <CardDescription>
                Após o número de falhas dentro da janela, o servidor sai do balanceamento pela mesma janela. Servidores de backup só recebem tráfego
                quando todos os principais falham.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {servers.fields.map((field, index) => {
                const serverErrors = errors.servers?.[index];
                return (
                  <div key={field.id} className="rounded-lg border p-3">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_6rem_5rem_5rem_6rem]">
                      <FormField className="col-span-2 sm:col-span-1" id={`servers.${index}.address`} label="Endereço" error={serverErrors?.address?.message}>
                        <Input
                          id={`servers.${index}.address`}
                          className="font-mono"
                          placeholder="10.0.0.10"
                          spellCheck={false}
                          aria-invalid={!!serverErrors?.address}
                          {...form.register(`servers.${index}.address`)}
                        />
                      </FormField>
                      <FormField id={`servers.${index}.port`} label="Porta" error={serverErrors?.port?.message}>
                        <Input id={`servers.${index}.port`} type="number" className="font-mono" aria-invalid={!!serverErrors?.port} {...form.register(`servers.${index}.port`, { valueAsNumber: true })} />
                      </FormField>
                      <FormField id={`servers.${index}.weight`} label="Peso" error={serverErrors?.weight?.message}>
                        <Input id={`servers.${index}.weight`} type="number" aria-invalid={!!serverErrors?.weight} {...form.register(`servers.${index}.weight`, { valueAsNumber: true })} />
                      </FormField>
                      <FormField id={`servers.${index}.maxFails`} label="Falhas" error={serverErrors?.maxFails?.message}>
                        <Input id={`servers.${index}.maxFails`} type="number" aria-invalid={!!serverErrors?.maxFails} {...form.register(`servers.${index}.maxFails`, { valueAsNumber: true })} />
                      </FormField>
                      <FormField id={`servers.${index}.failTimeoutSeconds`} label="Janela (s)" error={serverErrors?.failTimeoutSeconds?.message}>
                        <Input
                          id={`servers.${index}.failTimeoutSeconds`}
                          type="number"
                          aria-invalid={!!serverErrors?.failTimeoutSeconds}
                          {...form.register(`servers.${index}.failTimeoutSeconds`, { valueAsNumber: true })}
                        />
                      </FormField>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
                      <Controller
                        control={form.control}
                        name={`servers.${index}.isBackup`}
                        render={({ field: backup }) => (
                          <label className="flex items-center gap-2 text-sm">
                            <Switch checked={backup.value} onCheckedChange={backup.onChange} disabled={!canEdit} /> Backup
                          </label>
                        )}
                      />
                      <Controller
                        control={form.control}
                        name={`servers.${index}.isDown`}
                        render={({ field: down }) => (
                          <label className="flex items-center gap-2 text-sm">
                            <Switch checked={!down.value} onCheckedChange={(checked) => down.onChange(!checked)} disabled={!canEdit} /> Ativo
                          </label>
                        )}
                      />
                      {serverErrors?.isBackup?.message ? <span className="text-xs font-medium text-destructive">{serverErrors.isBackup.message}</span> : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="ml-auto text-muted-foreground"
                        disabled={servers.fields.length === 1}
                        onClick={() => servers.remove(index)}
                      >
                        <Trash2 /> Remover
                      </Button>
                    </div>
                  </div>
                );
              })}
              {errors.servers?.root?.message || errors.servers?.message ? (
                <p className="text-sm font-medium text-destructive">{errors.servers.root?.message ?? errors.servers.message}</p>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={() => servers.append({ ...EMPTY_SERVER })} disabled={servers.fields.length >= 100}>
                <Plus /> Adicionar servidor
              </Button>
            </CardContent>
          </Card>
        </fieldset>

        {showPanel ? <NginxErrorPanel error={save.error} /> : null}

        {canEdit ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => navigate("/upstreams")}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending || (!isNew && !isDirty)}>
              {save.isPending ? "Aplicando no Nginx..." : isNew ? "Criar pool" : "Salvar"}
            </Button>
          </div>
        ) : null}
      </form>
    </>
  );
}
