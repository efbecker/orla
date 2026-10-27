import { Check, Copy, Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Read-only code viewer with line numbers, copy and download. */
export function CodeView({
  code,
  filename,
  highlightLines = [],
  className,
}: {
  code: string;
  filename: string;
  highlightLines?: number[];
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const lines = code.replace(/\n$/, "").split("\n");
  const highlighted = new Set(highlightLines);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={cn("overflow-hidden rounded-lg border bg-[#0f1420] text-[#d6deeb]", className)}>
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="font-mono text-xs text-white/60">{filename}</span>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-white/80 hover:bg-white/10 hover:text-white" onClick={copy}>
            {copied ? <Check /> : <Copy />} {copied ? "Copiado" : "Copiar"}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-white/80 hover:bg-white/10 hover:text-white" onClick={download}>
            <Download /> Baixar
          </Button>
        </div>
      </div>
      <div className="max-h-[70vh] overflow-auto py-3">
        <pre className="font-mono text-[12.5px] leading-5">
          {lines.map((line, index) => {
            const number = index + 1;
            const isComment = line.trimStart().startsWith("#");
            return (
              <div key={number} className={cn("flex px-4", highlighted.has(number) && "bg-red-500/20")}>
                <span className="w-10 shrink-0 select-none pr-4 text-right text-white/30">{number}</span>
                <code className={cn("whitespace-pre", isComment && "text-[#7f8ea3]")}>{line || " "}</code>
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
}
