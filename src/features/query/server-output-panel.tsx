import { useMemo } from "react";
import { CopyIcon, EraserIcon, TerminalIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useServerOutputStore, type ServerOutputEntry } from "@/lib/server-output";

interface ServerOutputPanelProps {
  connectionId: string;
  connectionName: string;
  enabled: boolean;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onClose: () => void;
}

function levelVariant(level: string): "destructive" | "secondary" | "outline" {
  const upper = level.toUpperCase();
  if (upper.includes("ERROR") || upper.includes("FEHLER")) return "destructive";
  if (upper.includes("WARN")) return "secondary";
  return "outline";
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString();
}

function asText(entries: ServerOutputEntry[]): string {
  return entries
    .map((entry) => {
      const detail = entry.detail ? ` — ${entry.detail}` : "";
      return `[${formatTime(entry.at)}] ${entry.level}: ${entry.message}${detail}`;
    })
    .join("\n");
}

export function ServerOutputPanel({
  connectionId,
  connectionName,
  enabled,
  busy,
  onToggle,
  onClose,
}: ServerOutputPanelProps) {
  const entries = useServerOutputStore((state) => state.entries[connectionId]);
  const clear = useServerOutputStore((state) => state.clear);
  const rows = useMemo(() => entries ?? [], [entries]);

  const handleCopy = async () => {
    if (rows.length === 0) return;
    try {
      await navigator.clipboard.writeText(asText(rows));
      toast.success("Server-Ausgabe kopiert");
    } catch {
      toast.error("Kopieren fehlgeschlagen");
    }
  };

  return (
    <div className="flex max-h-64 shrink-0 flex-col border-t bg-card/40">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs">
        <TerminalIcon className="size-3.5 text-muted-foreground" />
        <span className="font-medium">Server-Ausgabe</span>
        <span className="tabular-nums text-muted-foreground">({rows.length})</span>
        <span className="truncate text-muted-foreground">{connectionName}</span>
        <label className="ml-auto flex items-center gap-2 text-muted-foreground">
          <Switch checked={enabled} disabled={busy} onCheckedChange={onToggle} />
          Aktiv
        </label>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 gap-1.5 px-2 text-xs"
          disabled={rows.length === 0}
          onClick={() => void handleCopy()}
        >
          <CopyIcon className="size-3" />
          Kopieren
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 gap-1.5 px-2 text-xs"
          disabled={rows.length === 0}
          onClick={() => clear(connectionId)}
        >
          <EraserIcon className="size-3" />
          Leeren
        </Button>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onClose}>
          <XIcon className="size-3" />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {rows.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            {enabled
              ? "Noch keine Ausgabe für diese Sitzung."
              : "Server-Ausgabe ist für diese Sitzung nicht aktiv."}
          </p>
        ) : (
          <ul className="divide-y">
            {rows.map((entry) => (
              <li key={entry.id} className="flex items-start gap-2 px-3 py-1.5 text-xs">
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatTime(entry.at)}
                </span>
                <Badge variant={levelVariant(entry.level)} className="shrink-0 px-1.5 py-0 text-[10px]">
                  {entry.level}
                </Badge>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                  {entry.message}
                  {entry.detail && (
                    <span className="block text-muted-foreground">{entry.detail}</span>
                  )}
                </span>
                {entry.database && (
                  <span className="shrink-0 text-muted-foreground">{entry.database}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
