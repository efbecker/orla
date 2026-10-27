/** A value that cannot be safely rendered into an Nginx configuration. */
export class ConfigValidationError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export interface NginxDiagnostic {
  level: string;
  message: string;
  /** Path relative to the managed roots (e.g. conf.d/host-3.conf). */
  file?: string;
  line?: number;
  /** Offending line of the generated file, when known. */
  source?: string;
}

/** `nginx -t` rejected the generated configuration; the snapshot was restored. */
export class NginxTestError extends Error {
  constructor(
    readonly diagnostics: NginxDiagnostic[],
    readonly output: string,
  ) {
    super(formatDiagnostics(diagnostics, output));
    this.name = "NginxTestError";
  }
}

/** The reload command failed after a successful test; the snapshot was restored. */
export class NginxReloadError extends Error {
  constructor(readonly output: string) {
    super(`Falha ao recarregar o Nginx: ${output.trim() || "sem saída"}`);
    this.name = "NginxReloadError";
  }
}

function formatDiagnostics(diagnostics: NginxDiagnostic[], output: string): string {
  const first = diagnostics.find((d) => d.level === "emerg") ?? diagnostics[0];
  if (!first) {
    return `O Nginx rejeitou a configuração: ${output.trim() || "sem saída"}`;
  }
  const location = first.file
    ? ` (arquivo ${first.file}${first.line !== undefined ? `, linha ${first.line}` : ""})`
    : "";
  return `O Nginx rejeitou a configuração: ${first.message}${location}`;
}
