import { ProviderLogo } from "@/components/provider-logo";
import { cn } from "@/lib/utils";
import { callsPerHour, formatAgo, type McpVariantProps } from "./data";

export function McpActivityVariant({ state }: McpVariantProps) {
  const hours = callsPerHour(state.calls);
  const peak = Math.max(1, ...hours);
  const failed = state.calls.filter((call) => !call.ok).length;
  const sorted = state.calls.map((call) => call.ms).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const kindByName = new Map(state.databases.map((db) => [db.name, db.kind]));
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
        {[
          { value: state.calls.length, label: "Aufrufe", warn: false },
          { value: `${median} ms`, label: "Median", warn: false },
          { value: failed, label: "Fehler", warn: failed > 0 },
        ].map(({ value, label, warn }) => (
          <div key={label}>
            <div className={cn("text-3xl font-semibold tabular-nums", warn && "text-destructive")}>
              {value}
            </div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
        <div className="flex h-14 min-w-48 flex-1 items-end gap-[3px]" aria-hidden>
          {hours.map((count, index) => (
            <span
              key={index}
              className="flex-1 rounded-sm bg-primary/70"
              style={{ height: `${Math.max(6, (count / peak) * 100)}%`, opacity: count ? 1 : 0.2 }}
            />
          ))}
        </div>
      </div>
      <ol className="space-y-0.5">
        {state.calls.slice(0, 6).map((call) => (
          <li
            key={call.id}
            className="grid grid-cols-[1.25rem_6rem_1fr_auto_3rem] items-center gap-3 rounded-md px-2 py-1.5 text-sm odd:bg-muted/40"
          >
            <ProviderLogo kind={kindByName.get(call.connection)} className="size-4" />
            <span className="font-mono text-xs">{call.tool}</span>
            <span className="truncate text-muted-foreground">{call.connection}</span>
            <span
              className={cn(
                "font-mono text-xs tabular-nums",
                call.ok ? "text-muted-foreground" : "text-destructive",
              )}
            >
              {call.ok ? `${call.ms} ms` : "Fehler"}
            </span>
            <span className="text-right text-xs text-muted-foreground">{formatAgo(call.ts)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
