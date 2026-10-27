import { ServerCrash } from "lucide-react";
import { ApiError, errorMessage } from "@/lib/api";

/** Shows the `nginx -t` diagnostics of a rejected change, or the plain error. */
export function NginxErrorPanel({ error }: { error: unknown }) {
  const diagnostics = error instanceof ApiError ? error.diagnostics : [];
  return (
    <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
      <div className="flex items-start gap-3">
        <ServerCrash className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-medium text-destructive">
            {diagnostics.length > 0 ? "O Nginx recusou a configuração. Nada foi alterado." : errorMessage(error)}
          </p>
          {diagnostics.map((diagnostic, index) => (
            <div key={index} className="rounded-md border bg-card p-3">
              <p>{diagnostic.message}</p>
              {diagnostic.file ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {diagnostic.file}
                  {diagnostic.line ? `, linha ${diagnostic.line}` : ""}
                </p>
              ) : null}
              {diagnostic.source ? <code className="mt-2 block rounded bg-muted px-2 py-1 font-mono text-xs">{diagnostic.source}</code> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
