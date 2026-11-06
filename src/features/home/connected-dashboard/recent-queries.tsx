import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, SquareTerminal } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useActiveDatabase } from "@/lib/db-selection";
import type { QueryHistoryEntry } from "@/lib/query-history";
import { useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";
import type { Activity } from "../activity";
import { ActivityTimeline } from "./activity-timeline";

export function RecentQueries({
  recent,
  activity,
}: {
  recent: QueryHistoryEntry[];
  activity?: Activity;
}) {
  const navigate = useNavigate();
  const database = useActiveDatabase();
  const [highlight, setHighlight] = useState<string | null>(null);

  function reopen(entry: QueryHistoryEntry) {
    const id = useTableTabs.getState().openQueryTabWithSql(entry.sql);
    void navigate({ to: "/query/$id", params: { id } });
  }

  return (
    <section className="flex h-full flex-col">
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <h2 className="text-sm font-semibold">Letzte Abfragen</h2>
        <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
          <Link to="/query">
            SQL-Arbeitsplatz
            <ArrowRight className="size-3" />
          </Link>
        </Button>
      </div>
      {activity && activity.points.length > 0 && (
        <ActivityTimeline activity={activity} highlight={highlight} />
      )}
      {recent.length ? (
        <ul
          aria-label="Letzte Abfragen"
          className="min-h-0 flex-1 divide-y overflow-auto rounded-xl border bg-card"
          onPointerLeave={() => setHighlight(null)}
        >
          {recent.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                disabled={entry.truncated || entry.database !== database}
                title={
                  entry.truncated
                    ? "Nur gekürzt im Verlauf gespeichert"
                    : entry.database !== database
                      ? "Lief in einer anderen Datenbank"
                      : "In neuem Abfrage-Tab öffnen"
                }
                onClick={() => reopen(entry)}
                onPointerEnter={() => setHighlight(entry.id)}
                onFocus={() => setHighlight(entry.id)}
                onBlur={() => setHighlight(null)}
                className="group flex w-full items-center gap-3 px-4 py-3 text-left enabled:hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none disabled:cursor-default"
              >
                <SquareTerminal
                  className={cn(
                    "size-4 shrink-0",
                    entry.error ? "text-destructive" : "text-primary",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs">{entry.sql}</span>
                  <span className="mt-1 block text-[10px] text-muted-foreground">
                    {new Date(entry.ranAt).toLocaleString("de-DE", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}{" "}
                    · {entry.error ? "Fehlgeschlagen" : `${entry.rowCount ?? 0} Zeilen`}
                  </span>
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground group-enabled:group-hover:hidden group-focus-visible:hidden">
                  {entry.durationMs == null ? "—" : `${entry.durationMs} ms`}
                </span>
                <ArrowRight className="hidden size-3.5 text-muted-foreground group-enabled:group-hover:block group-focus-visible:block" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed px-5 py-6 text-xs text-muted-foreground">
          Deine ausgeführten Abfragen erscheinen hier mit Laufzeit und Ergebnis.
        </p>
      )}
    </section>
  );
}
