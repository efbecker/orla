import type { CompiledFile, HostGraph } from "../types.js";
import { fileRefs } from "./files.js";
import { escapeHtml, textFile } from "./shared.js";

const DEFAULT_TITLE = "Em manutenção";
const DEFAULT_MESSAGE = "Estamos realizando uma manutenção programada. Voltaremos em instantes.";

/** www/maintenance-{id}.html served with status 503 while maintenance mode is on. */
export function renderMaintenancePage(host: HostGraph): CompiledFile {
  if (host.maintenanceHtml && host.maintenanceHtml.trim().length > 0) {
    return textFile(fileRefs.maintenancePage(host.id), host.maintenanceHtml);
  }
  const title = escapeHtml(host.maintenanceTitle?.trim() || DEFAULT_TITLE);
  const message = escapeHtml(host.maintenanceMessage?.trim() || DEFAULT_MESSAGE);
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f7f9; --card: #ffffff; --text: #1d1f24; --muted: #5c6370; --accent: #f38020; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111317; --card: #1b1e24; --text: #e8eaed; --muted: #a0a6b1; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
         background: var(--bg); color: var(--text); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 520px; width: 100%; background: var(--card); border-radius: 12px; padding: 40px 32px;
         box-shadow: 0 1px 3px rgba(0, 0, 0, .08); border-top: 4px solid var(--accent); }
  h1 { margin: 0 0 12px; font-size: 1.5rem; }
  p { margin: 0; color: var(--muted); }
  small { display: block; margin-top: 24px; color: var(--muted); font-size: .8rem; }
</style>
</head>
<body>
<main>
  <h1>${title}</h1>
  <p>${message}</p>
  <small>Erro 503 · Serviço temporariamente indisponível</small>
</main>
</body>
</html>
`;
  return textFile(fileRefs.maintenancePage(host.id), html);
}
