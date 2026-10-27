import { Star, X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { looksLikeDomain, normalizeDomain } from "@/features/hosts/labels";
import { cn } from "@/lib/utils";

/** Tag input for host domains. The first domain is the primary one. */
export function DomainsInput({
  id,
  value,
  onChange,
  invalid,
  disabled,
}: {
  id: string;
  value: string[];
  onChange: (domains: string[]) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);

  const commit = (raw: string): boolean => {
    const parts = raw.split(/[\s,;]+/).map(normalizeDomain).filter(Boolean);
    if (parts.length === 0) return true;
    const invalidPart = parts.find((part) => !looksLikeDomain(part));
    if (invalidPart) {
      setDraftError(`"${invalidPart}" não parece um domínio válido.`);
      return false;
    }
    const next = [...value];
    for (const part of parts) if (!next.includes(part)) next.push(part);
    onChange(next);
    setDraft("");
    setDraftError(null);
    return true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "," || event.key === " ") {
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const makePrimary = (domain: string) => onChange([domain, ...value.filter((item) => item !== domain)]);

  return (
    <div>
      <div
        className={cn(
          "flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1.5 shadow-sm focus-within:ring-2 focus-within:ring-ring",
          (invalid || draftError) && "border-destructive",
          disabled && "opacity-50",
        )}
      >
        {value.map((domain, index) => (
          <span
            key={domain}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs",
              index === 0 ? "border-primary/40 bg-accent text-accent-foreground" : "bg-secondary",
            )}
          >
            {index === 0 ? <Star className="h-3 w-3 fill-current" aria-label="Domínio principal" /> : null}
            {domain}
            {index > 0 && !disabled ? (
              <button type="button" className="ml-0.5 text-muted-foreground hover:text-foreground" onClick={() => makePrimary(domain)} title="Tornar principal">
                <Star className="h-3 w-3" />
                <span className="sr-only">Tornar {domain} o domínio principal</span>
              </button>
            ) : null}
            {!disabled ? (
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onChange(value.filter((item) => item !== domain))}>
                <X className="h-3 w-3" />
                <span className="sr-only">Remover {domain}</span>
              </button>
            ) : null}
          </span>
        ))}
        <input
          id={id}
          value={draft}
          disabled={disabled}
          onChange={(event) => {
            setDraft(event.target.value);
            setDraftError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => commit(draft)}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text");
            if (/[\s,;]/.test(text.trim())) {
              event.preventDefault();
              commit(`${draft}${text}`);
            }
          }}
          placeholder={value.length === 0 ? "exemplo.com.br, www.exemplo.com.br" : "Adicionar domínio"}
          className="h-6 min-w-[12rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          aria-invalid={invalid || !!draftError}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {draftError ? <p className="mt-1 text-xs font-medium text-destructive">{draftError}</p> : null}
    </div>
  );
}
