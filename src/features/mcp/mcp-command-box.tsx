import { Check, Copy, Terminal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface McpCommandBoxProps {
  command: string;
}

export function McpCommandBox({ command }: McpCommandBoxProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      toast.success("Befehl in Zwischenablage kopiert.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Kopieren fehlgeschlagen.");
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card/60 p-4 shadow-2xs">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Terminal className="size-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">
              Manueller Startbefehl / Andere Clients
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Verwende diesen Befehl, wenn dein Tool nicht automatisch aufgelistet wird oder du den
            MCP-Server manuell konfigurieren möchtest.
          </p>
        </div>

        <Button
          variant={copied ? "default" : "outline"}
          size="sm"
          className="h-8 shrink-0 text-xs transition-all"
          onClick={copy}
        >
          {copied ? (
            <>
              <Check className="size-3.5" />
              Kopiert
            </>
          ) : (
            <>
              <Copy className="size-3.5" />
              Kopieren
            </>
          )}
        </Button>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-border/60 bg-muted/70 p-3">
        <code className="block font-mono text-[11px] text-foreground/90 whitespace-pre">
          {command}
        </code>
      </div>
    </div>
  );
}
