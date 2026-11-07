import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import type { DatabaseKind } from "@/lib/db";
import { cn } from "@/lib/utils";
import { callsPerHour, formatAgo, type LabCall } from "./data";

interface McpStudioLogProps {
  calls: LabCall[];
  kindByName: Map<string, DatabaseKind>;
}

export function McpStudioLog({ calls, kindByName }: McpStudioLogProps) {
  const [open, setOpen] = useState<number | null>(null);
  const [visible, setVisible] = useState(12);
  const hours = callsPerHour(calls);
  const peak = Math.max(1, ...hours);
  const failed = calls.filter((call) => !call.ok).length;
  const sorted = calls.map((call) => call.ms).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        {[
          { value: calls.length, label: "Aufrufe", warn: false },
          { value: `${median} ms`, label: "Median", warn: false },
          { value: failed, label: "Fehler", warn: failed > 0 },
        ].map(({ value, label, warn }) => (
          <div key={label}>
            <div className={cn("text-2xl font-semibold tabular-nums", warn && "text-destructive")}>
              {value}
            </div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
        <div className="flex h-12 min-w-40 flex-1 items-end gap-[3px]" aria-hidden>
          {hours.map((count, hour) => (
            <span
              key={`h${hour}`}
              className="flex-1 rounded-sm bg-primary/70"
              style={{ height: `${Math.max(6, (count / peak) * 100)}%`, opacity: count ? 1 : 0.2 }}
            />
          ))}
        </div>
      </div>
      <ol className="space-y-0.5">
        {calls.slice(0, visible).map((call) => {
          const expanded = open === call.id;
          return (
            <li key={call.id} className={cn("rounded-lg", expanded && "bg-muted/40")}>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : call.id)}
                aria-expanded={expanded}
                className="grid w-full cursor-pointer grid-cols-[0.875rem_1rem_5.5rem_1fr_auto_3rem] items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted/50"
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 text-muted-foreground transition-transform",
                    expanded && "rotate-90",
                  )}
                  aria-hidden
                />
                <ProviderLogo kind={kindByName.get(call.connection)} className="size-4" />
                <span className="font-mono text-xs">{call.tool}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {summarize(call.params) || call.connection}
                </span>
                <span
                  className={cn(
                    "font-mono text-xs tabular-nums",
                    call.ok ? "text-muted-foreground" : "text-destructive",
                  )}
                >
                  {call.ok ? `${call.ms} ms` : "Fehler"}
                </span>
                <span className="text-right text-xs text-muted-foreground">
                  {formatAgo(call.ts)}
                </span>
              </button>
              {expanded && (
                <div className="grid gap-3 px-2 pb-3 pt-1 md:grid-cols-2">
                  {[
                    { label: "Parameter", body: JSON.stringify(call.params, null, 2) },
                    { label: "Antwort", body: call.response },
                  ].map(({ label, body }) => (
                    <div key={label} className="min-w-0 space-y-1.5">
                      <div className="text-[11px] text-muted-foreground">
                        {label}
                        {label === "Antwort" && ` · ${call.connection}`}
                      </div>
                      <pre
                        className={cn(
                          "max-h-56 overflow-auto rounded-md bg-background/70 p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words",
                          label === "Antwort" && !call.ok && "text-destructive",
                        )}
                      >
                        {body}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {visible < calls.length && (
        <button
          type="button"
          onClick={() => setVisible(visible + 24)}
          className="cursor-pointer px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          Mehr anzeigen
        </button>
      )}
    </div>
  );
}

function summarize(params: Record<string, unknown>): string {
  const first = Object.values(params)[0];
  if (first === undefined) return "";
  return Array.isArray(first) ? first.join(", ") : String(first);
}
