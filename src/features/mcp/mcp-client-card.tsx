import { Check, FolderCode, MinusCircle, PlusCircle, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { McpClient } from "@/lib/mcp";
import { cn } from "@/lib/utils";

interface McpClientCardProps {
  client: McpClient;
  onToggle: () => void;
}

export function McpClientCard({ client, onToggle }: McpClientCardProps) {
  return (
    <div
      className={cn(
        "group relative flex flex-col justify-between gap-4 rounded-2xl border p-4 shadow-2xs transition-all",
        client.registered
          ? "border-primary/40 bg-card/90 ring-1 ring-primary/10"
          : "border-border/80 bg-card/50 hover:border-border",
      )}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/70 shadow-2xs transition-colors",
                client.registered
                  ? "bg-primary/10 text-primary border-primary/20"
                  : "bg-background/80 text-muted-foreground",
              )}
            >
              <Terminal className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{client.name}</span>
                {client.registered ? (
                  <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px]">
                    <Check className="size-3" />
                    Aktiv
                  </Badge>
                ) : client.installed ? (
                  <Badge variant="secondary" className="text-[10px]">
                    Erkannt
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    Nicht installiert
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {client.registered
                  ? "Automatisch per MCP-Protokoll verbunden"
                  : client.installed
                    ? "Bereit für 1-Klick-Verbindung"
                    : "Konfigurationsdatei nicht im Standardpfad"}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 rounded-lg bg-muted/50 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
          <FolderCode className="size-3.5 shrink-0 opacity-70" />
          <span className="truncate" title={client.configPath}>
            {client.configPath}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border/40 pt-3">
        <span className="text-[11px] text-muted-foreground">
          {client.registered ? "Im Client hinterlegt" : "Server eintragen"}
        </span>
        <Button
          variant={client.registered ? "outline" : "default"}
          size="sm"
          className="h-8 text-xs font-medium"
          onClick={onToggle}
        >
          {client.registered ? (
            <>
              <MinusCircle className="size-3.5" />
              Entfernen
            </>
          ) : (
            <>
              <PlusCircle className="size-3.5" />
              Hinzufügen
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
