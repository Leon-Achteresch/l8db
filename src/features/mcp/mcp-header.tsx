import { Bot, CheckCircle2, PowerOff } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface McpHeaderProps {
  enabled: boolean;
  exposedCount: number;
  onToggleEnabled: (enabled: boolean) => void;
}

export function McpHeader({ enabled, exposedCount, onToggleEnabled }: McpHeaderProps) {
  return (
    <header className="relative overflow-hidden py-6 px-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border/80 bg-background/80 shadow-xs">
            <Bot className="size-6 text-primary" />
            <span
              className={cn("absolute -top-1 -right-1 flex size-3 items-center justify-center")}
            >
              {enabled ? (
                <>
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </>
              ) : (
                <span className="relative inline-flex size-2 rounded-full bg-muted-foreground/40" />
              )}
            </span>
          </div>

          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                Model Context Protocol (MCP)
              </h1>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
                  enabled
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {enabled ? (
                  <>
                    <CheckCircle2 className="size-3" />
                    Aktiv ({exposedCount} freigegeben)
                  </>
                ) : (
                  <>
                    <PowerOff className="size-3" />
                    Pausiert
                  </>
                )}
              </span>
            </div>
            <p className="max-w-2xl text-xs text-muted-foreground sm:text-sm leading-relaxed">
              Verbinde deine Datenbanken sicher mit Claude Code, Cursor, Windsurf und anderen
              KI-Assistenten. Der Server startet automatisch bei Anfragen der CLIs – l8db muss dafür
              nicht geöffnet sein.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/60 px-4 py-3 sm:flex-col sm:items-end sm:justify-center">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground">
              {enabled ? "Server aktiv" : "Server pausiert"}
            </span>
            <Switch
              checked={enabled}
              onCheckedChange={onToggleEnabled}
              aria-label="MCP-Server aktivieren oder pausieren"
            />
          </div>
          <span className="text-[10px] text-muted-foreground">
            {enabled ? "Bereit für KI-Werkzeuge" : "Alle Anfragen werden blockiert"}
          </span>
        </div>
      </div>
    </header>
  );
}
