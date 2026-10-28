import { Pause, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MAX_REALTIME_MESSAGES, type RealtimeEntry } from "./use-realtime-session";

type Filter = "all" | "postgres_changes" | "broadcast" | "presence" | "system";

function category(event: string): Filter {
  if (event === "postgres_changes") return "postgres_changes";
  if (event === "broadcast") return "broadcast";
  if (event.startsWith("presence")) return "presence";
  return "system";
}

function summary(entry: RealtimeEntry) {
  const payload = entry.payload as Record<string, unknown> | null;
  if (entry.event === "postgres_changes") {
    const data = payload?.data as Record<string, unknown> | undefined;
    return `${data?.type ?? ""} ${data?.schema ?? ""}.${data?.table ?? ""}`;
  }
  if (entry.event === "broadcast") return String(payload?.event ?? "");
  if (entry.event === "phx_reply") return String(payload?.status ?? "");
  if (entry.event === "system") return String(payload?.message ?? payload?.status ?? "");
  return "";
}

export function RealtimeMessageList({
  messages,
  paused,
  skipped,
  onPause,
  onClear,
}: {
  messages: RealtimeEntry[];
  paused: boolean;
  skipped: number;
  onPause: (paused: boolean) => void;
  onClear: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<number | null>(null);
  const visible =
    filter === "all" ? messages : messages.filter((entry) => category(entry.event) === filter);
  const current = messages.find((entry) => entry.id === selected) ?? null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={filter}
          onValueChange={(value) => value && setFilter(value as Filter)}
        >
          <ToggleGroupItem value="all" className="h-7 px-2 text-xs">
            Alle
          </ToggleGroupItem>
          <ToggleGroupItem value="postgres_changes" className="h-7 px-2 text-xs">
            Postgres
          </ToggleGroupItem>
          <ToggleGroupItem value="broadcast" className="h-7 px-2 text-xs">
            Broadcast
          </ToggleGroupItem>
          <ToggleGroupItem value="presence" className="h-7 px-2 text-xs">
            Presence
          </ToggleGroupItem>
          <ToggleGroupItem value="system" className="h-7 px-2 text-xs">
            System
          </ToggleGroupItem>
        </ToggleGroup>
        <span className="text-xs text-muted-foreground">
          {messages.length}/{MAX_REALTIME_MESSAGES}
          {skipped > 0 && ` · ${skipped} pausiert verworfen`}
        </span>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="outline" onClick={() => onPause(!paused)}>
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {paused ? "Fortsetzen" : "Pausieren"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear} disabled={messages.length === 0}>
            <Trash2 className="size-3.5" /> Leeren
          </Button>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ul className="h-[50vh] min-h-64 overflow-auto rounded-xl border">
          {visible.length === 0 && (
            <li className="p-4 text-center text-xs text-muted-foreground">
              Noch keine Nachrichten.
            </li>
          )}
          {visible.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => setSelected(entry.id)}
                className={`flex w-full items-center gap-2 border-b px-2 py-1 text-left text-xs last:border-b-0 ${selected === entry.id ? "bg-primary/10" : "hover:bg-muted"}`}
              >
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {new Date(entry.receivedAt).toLocaleTimeString("de-DE")}
                </span>
                <Badge variant="outline">{entry.event}</Badge>
                <span className="min-w-0 truncate">{summary(entry)}</span>
              </button>
            </li>
          ))}
        </ul>
        <pre className="h-[50vh] min-h-64 overflow-auto rounded-xl border bg-muted/30 p-3 font-mono text-xs">
          {current ? JSON.stringify(current.payload, null, 2) : "Nachricht auswählen."}
        </pre>
      </div>
    </div>
  );
}
