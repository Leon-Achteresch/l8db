import { useVirtualizer } from "@tanstack/react-virtual";
import { CopyIcon, EraserIcon } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { copyText } from "@/lib/clipboard";
import {
  MAX_SERVER_OUTPUT_ENTRIES,
  type ServerOutputEntry,
  useServerOutputStore,
} from "@/lib/server-output";
import { cn } from "@/lib/utils";
import { showCopiedMessage } from "@/lib/workspace-status";

interface ServerOutputPanelProps {
  connectionId: string;
  enabled: boolean;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  tabs: ReactNode;
}

const ROW_HEIGHT = 20;
const NO_ENTRIES: ServerOutputEntry[] = [];

function levelClass(level: string): string {
  const upper = level.toUpperCase();
  if (upper.includes("ERROR") || upper.includes("FEHLER")) return "text-destructive";
  if (upper.includes("WARN")) return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground";
}

function asText(entries: ServerOutputEntry[]): string {
  return entries
    .map((entry) =>
      entry.level === "OUTPUT"
        ? entry.message
        : `${entry.level}: ${entry.message}${entry.detail ? ` — ${entry.detail}` : ""}`,
    )
    .join("\n");
}

export function ServerOutputPanel({
  connectionId,
  enabled,
  busy,
  onToggle,
  tabs,
}: ServerOutputPanelProps) {
  const rows = useServerOutputStore((state) => state.entries[connectionId]) ?? NO_ENTRIES;
  const clear = useServerOutputStore((state) => state.clear);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
    useFlushSync: false,
  });
  const last = rows.at(-1)?.id;
  useLayoutEffect(() => {
    if (last) virtualizer.scrollToIndex(rows.length - 1, { align: "end" });
  }, [last, rows.length, virtualizer]);
  const items = virtualizer.getVirtualItems();

  const handleCopy = async () => {
    try {
      await copyText(asText(rows));
      showCopiedMessage("Ausgabe kopiert");
    } catch {
      toast.error("Kopieren fehlgeschlagen");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 bg-muted/20 px-2 text-xs">
        {tabs}
        {rows.length >= MAX_SERVER_OUTPUT_ENTRIES && (
          <span className="text-muted-foreground">ältere Zeilen entfernt</span>
        )}
        <Switch
          aria-label="Ausgabe aktiv"
          title="Ausgabe aktiv"
          className="mr-1 ml-auto"
          checked={enabled}
          disabled={busy}
          onCheckedChange={onToggle}
        />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Ausgabe kopieren"
          title="Kopieren"
          disabled={rows.length === 0}
          onClick={() => void handleCopy()}
        >
          <CopyIcon className="size-3.5" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Ausgabe leeren"
          title="Leeren"
          disabled={rows.length === 0}
          onClick={() => clear(connectionId)}
        >
          <EraserIcon className="size-3.5" />
        </Button>
      </div>
      <div
        ref={scrollRef}
        role="log"
        aria-label="Ausgabe"
        className="min-h-0 flex-1 overflow-auto py-1"
      >
        {rows.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {enabled ? "Keine Ausgabe" : "Ausgabe ist aus"}
          </p>
        ) : (
          <div
            style={{
              paddingTop: items[0]?.start ?? 0,
              paddingBottom: virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0),
            }}
          >
            {items.map((item) => {
              const entry = rows[item.index];
              return (
                <div
                  key={entry.id}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  title={new Date(entry.at).toLocaleTimeString()}
                  className="flex gap-2 px-3 font-mono text-xs leading-5"
                >
                  {entry.level !== "OUTPUT" && (
                    <span className={cn("shrink-0", levelClass(entry.level))}>{entry.level}</span>
                  )}
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                    {entry.message}
                    {entry.detail && (
                      <span className="block text-muted-foreground">{entry.detail}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
