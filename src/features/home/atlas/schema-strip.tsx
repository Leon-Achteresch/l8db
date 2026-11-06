import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBytes } from "@/features/monitor/monitor-view/format";
import { useActiveCapabilities, useDbSelectionStore } from "@/lib/db-selection";
import { useDatabaseOverviewQuery, useSchemasQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { rankSchemas } from "./atlas-layout";

const STRIP_LIMIT = 8;

export function SchemaStrip({ connectionId, schema }: { connectionId: string; schema: string }) {
  const caps = useActiveCapabilities();
  const schemas = useSchemasQuery();
  const overview = useDatabaseOverviewQuery();
  const entries = useMemo(
    () =>
      rankSchemas(
        schemas.data ?? overview.data?.schemas.map((entry) => entry.schema) ?? [],
        overview.data,
      ),
    [schemas.data, overview.data],
  );
  const { shown, rest } = useMemo(() => {
    const shown = entries.slice(0, STRIP_LIMIT);
    const active = entries.findIndex((entry) => entry.name === schema);
    if (active >= STRIP_LIMIT) shown[STRIP_LIMIT - 1] = entries[active];
    const visible = new Set(shown.map((entry) => entry.name));
    return { shown, rest: entries.filter((entry) => !visible.has(entry.name)) };
  }, [entries, schema]);
  if (!caps.schemas || entries.length < 2) return null;
  const select = (name: string) => useDbSelectionStore.getState().setSchema(connectionId, name);

  return (
    <nav
      aria-label="Schemas"
      className="-mx-1 flex min-w-0 items-center gap-1 overflow-x-auto px-1 pb-1 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] [scrollbar-width:none]"
    >
      {shown.map((entry) => {
        const active = entry.name === schema;
        return (
          <button
            key={entry.name}
            type="button"
            aria-pressed={active}
            onClick={() => select(entry.name)}
            className={cn(
              "flex h-12 w-32 shrink-0 flex-col justify-between rounded-md px-2.5 pb-1.5 pt-1.5 text-left transition-colors hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-primary",
              active && "bg-muted",
            )}
          >
            <span
              className={cn(
                "truncate text-[13px] font-medium",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {entry.name}
            </span>
            <span className="truncate text-xs tabular-nums text-muted-foreground">
              {[
                entry.bytes != null ? formatBytes(entry.bytes) : null,
                entry.tables != null
                  ? `${entry.tables.toLocaleString("de-DE")} ${entry.tables === 1 ? "Tabelle" : "Tabellen"}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ") || "nicht geladen"}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "h-0.5 w-full overflow-hidden rounded-full bg-border",
                entry.bytes == null && entry.tables == null && "invisible",
              )}
            >
              <span
                className="block h-full rounded-full bg-muted-foreground/40"
                style={{ width: `${Math.max(2, entry.share * 100)}%` }}
              />
            </span>
          </button>
        );
      })}
      {rest.length > 0 && (
        <Select value="" onValueChange={select}>
          <SelectTrigger
            size="sm"
            className="ml-1 w-auto shrink-0 text-xs"
            aria-label="Weitere Schemas"
          >
            <SelectValue placeholder={`+${rest.length.toLocaleString("de-DE")} weitere`} />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {rest.map((entry) => (
              <SelectItem key={entry.name} value={entry.name} className="text-xs">
                {entry.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </nav>
  );
}
