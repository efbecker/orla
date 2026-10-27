import { Link } from "react-router-dom";
import { FormField } from "@/components/form-field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ALGORITHM_LABELS } from "@/features/hosts/labels";
import type { UpstreamPool } from "@/lib/types";
import { cn } from "@/lib/utils";

export type OriginMode = "server" | "pool" | "none";

export interface OriginValue {
  mode: OriginMode;
  scheme: "HTTP" | "HTTPS";
  address: string;
  port: string;
  poolId: string;
}

export interface OriginErrors {
  address?: string;
  port?: string;
  poolId?: string;
}

const MODES: Array<{ value: OriginMode; title: string; description: string }> = [
  { value: "server", title: "Servidor de origem", description: "Um endereço e porta, como 127.0.0.1:3000." },
  { value: "pool", title: "Pool de upstreams", description: "Vários servidores com balanceamento de carga." },
  { value: "none", title: "Sem origem", description: "Só redirecionamentos, manutenção ou rotas próprias." },
];

/** Address validation shared with the API: hostname, IPv4, [IPv6] or unix socket. */
export function validateOrigin(value: OriginValue): OriginErrors {
  const errors: OriginErrors = {};
  if (value.mode === "server") {
    const address = value.address.trim();
    if (!address) errors.address = "Informe o endereço da origem.";
    else if (/[\s;{}"'$\\]/.test(address) || /^[a-z]+:\/\//i.test(address)) errors.address = "Informe só o host ou IP, sem http:// e sem espaços.";
    const port = Number(value.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) errors.port = "Porta entre 1 e 65535.";
  }
  if (value.mode === "pool" && !value.poolId) errors.poolId = "Escolha um pool.";
  return errors;
}

/** Converts the origin choice into API fields. */
export function originToApi(value: OriginValue): Record<string, unknown> {
  if (value.mode === "server") {
    return { upstream: { scheme: value.scheme, address: value.address.trim(), port: Number(value.port) } };
  }
  if (value.mode === "pool") return { upstreamPoolId: Number(value.poolId) };
  return { upstreamPoolId: null };
}

export function OriginFields({
  value,
  onChange,
  errors,
  pools,
  disabled,
  serverLabel = "Servidor de origem",
}: {
  value: OriginValue;
  onChange: (value: OriginValue) => void;
  errors: OriginErrors;
  pools: UpstreamPool[];
  disabled?: boolean;
  serverLabel?: string;
}) {
  const set = (patch: Partial<OriginValue>) => onChange({ ...value, ...patch });
  const selectedPool = pools.find((pool) => String(pool.id) === value.poolId);

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Tipo de origem" className="grid gap-2 sm:grid-cols-3">
        {MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            role="radio"
            aria-checked={value.mode === mode.value}
            disabled={disabled}
            onClick={() => set({ mode: mode.value })}
            className={cn(
              "rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
              value.mode === mode.value ? "border-primary bg-accent" : "bg-card hover:bg-secondary/60",
            )}
          >
            <p className="text-sm font-medium">{mode.value === "server" ? serverLabel : mode.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{mode.description}</p>
          </button>
        ))}
      </div>

      {value.mode === "server" ? (
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr_7rem]">
          <FormField id="origin-scheme" label="Protocolo">
            <Select value={value.scheme} onValueChange={(scheme) => set({ scheme: scheme as OriginValue["scheme"] })} disabled={disabled}>
              <SelectTrigger id="origin-scheme">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="HTTP">http://</SelectItem>
                <SelectItem value="HTTPS">https://</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="origin-address" label="Endereço" hint="IP, hostname ou [IPv6]." error={errors.address}>
            <Input
              id="origin-address"
              value={value.address}
              onChange={(event) => set({ address: event.target.value })}
              placeholder="127.0.0.1"
              className="font-mono"
              aria-invalid={!!errors.address}
              disabled={disabled}
              spellCheck={false}
            />
          </FormField>
          <FormField id="origin-port" label="Porta" error={errors.port}>
            <Input
              id="origin-port"
              inputMode="numeric"
              value={value.port}
              onChange={(event) => set({ port: event.target.value.replace(/\D/g, "") })}
              placeholder="3000"
              className="font-mono"
              aria-invalid={!!errors.port}
              disabled={disabled}
            />
          </FormField>
        </div>
      ) : null}

      {value.mode === "pool" ? (
        pools.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Nenhum pool cadastrado.{" "}
            <Link to="/upstreams/new" className="font-medium text-primary hover:underline">
              Criar um pool
            </Link>
          </p>
        ) : (
          <FormField id="origin-pool" label="Pool" error={errors.poolId}>
            <Select value={value.poolId} onValueChange={(poolId) => set({ poolId })} disabled={disabled}>
              <SelectTrigger id="origin-pool" aria-invalid={!!errors.poolId}>
                <SelectValue placeholder="Escolha um pool" />
              </SelectTrigger>
              <SelectContent>
                {pools.map((pool) => (
                  <SelectItem key={pool.id} value={String(pool.id)}>
                    {pool.name} · {pool.servers.length} servidor{pool.servers.length === 1 ? "" : "es"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedPool ? (
              <p className="text-xs text-muted-foreground">
                {selectedPool.scheme.toLowerCase()}:// · {ALGORITHM_LABELS[selectedPool.algorithm]} ·{" "}
                {selectedPool.servers.map((server) => `${server.address}:${server.port}`).join(", ")}
              </p>
            ) : null}
          </FormField>
        )
      ) : null}
    </div>
  );
}
