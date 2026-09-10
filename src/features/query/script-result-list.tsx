import { CheckCircle2Icon, CircleDashedIcon, LoaderIcon, XCircleIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export type ScriptRunStatus = "pending" | "running" | "success" | "error" | "skipped";

export interface ScriptRunEntry {
  index: number;
  sql: string;
  start: number;
  end: number;
  status: ScriptRunStatus;
  durationMs: number | null;
  rowCount: number | null;
  rowsAffected: number | null;
  error: string | null;
}

interface ScriptResultListProps {
  entries: ScriptRunEntry[];
  activeIndex: number | null;
  onSelect: (entry: ScriptRunEntry) => void;
  onClose: () => void;
  note: string;
}

function firstLine(sql: string): string {
  const line = sql.split("\n").find((entry) => entry.trim().length > 0) ?? sql;
  return line.trim().slice(0, 120);
}

function statusIcon(status: ScriptRunStatus) {
  if (status === "success") return <CheckCircle2Icon className="size-3.5 text-emerald-500" />;
  if (status === "error") return <XCircleIcon className="size-3.5 text-destructive" />;
  if (status === "running") return <LoaderIcon className="size-3.5 animate-spin" />;
  return <CircleDashedIcon className="size-3.5 text-muted-foreground" />;
}

function detailOf(entry: ScriptRunEntry): string {
  const parts: string[] = [];
  if (entry.rowCount !== null) parts.push(`${entry.rowCount} Zeilen`);
  if (entry.rowsAffected !== null) parts.push(`${entry.rowsAffected} betroffen`);
  if (entry.durationMs !== null) parts.push(`${entry.durationMs} ms`);
  if (entry.status === "skipped") parts.push("nicht ausgeführt");
  return parts.join(" · ");
}

export function ScriptResultList({
  entries,
  activeIndex,
  onSelect,
  onClose,
  note,
}: ScriptResultListProps) {
  const failed = entries.filter((entry) => entry.status === "error").length;
  const done = entries.filter((entry) => entry.status === "success").length;

  return (
    <div className="flex max-h-64 shrink-0 flex-col border-t bg-card/40">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <span className="font-medium">Skriptausführung</span>
        <span className="text-muted-foreground">
          {done}/{entries.length} erfolgreich
          {failed > 0 ? ` · ${failed} fehlgeschlagen` : ""}
        </span>
        <span className="truncate text-muted-foreground">· {note}</span>
        <Button size="icon" variant="ghost" className="ml-auto size-6" onClick={onClose}>
          <XIcon className="size-3" />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="divide-y">
          {entries.map((entry) => (
            <button
              key={entry.index}
              type="button"
              onClick={() => onSelect(entry)}
              className={`flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/50 ${
                activeIndex === entry.index ? "bg-accent/60" : ""
              }`}
            >
              <span className="w-6 shrink-0 tabular-nums text-muted-foreground">
                {entry.index + 1}
              </span>
              <span className="mt-0.5 shrink-0">{statusIcon(entry.status)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono">{firstLine(entry.sql)}</span>
                {entry.error && (
                  <span className="block truncate text-destructive">{entry.error}</span>
                )}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{detailOf(entry)}</span>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
