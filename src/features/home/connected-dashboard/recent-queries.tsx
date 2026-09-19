import { Link } from "@tanstack/react-router";
import { ArrowRight, SquareTerminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { useQueryHistoryStore } from "@/lib/query-history";

type HistoryEntry = ReturnType<typeof useQueryHistoryStore.getState>["entries"][number];

export function RecentQueries({ recent }: { recent: HistoryEntry[] }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Letzte Abfragen</h2>
        <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
          <Link to="/query">
            SQL-Arbeitsplatz
            <ArrowRight className="size-3" />
          </Link>
        </Button>
      </div>
      {recent.length ? (
        <div className="divide-y rounded-xl border bg-card">
          {recent.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
              <SquareTerminal
                className={`size-4 shrink-0 ${entry.error ? "text-destructive" : "text-primary"}`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs">{entry.sql}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {new Date(entry.ranAt).toLocaleString("de-DE", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}{" "}
                  · {entry.error ? "Fehlgeschlagen" : `${entry.rowCount ?? 0} Zeilen`}
                </p>
              </div>
              <span className="text-[10px] text-muted-foreground">
                {entry.durationMs == null ? "—" : `${entry.durationMs} ms`}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed px-5 py-6 text-xs text-muted-foreground">
          Deine ausgeführten Abfragen erscheinen hier mit Laufzeit und Ergebnis.
        </p>
      )}
    </section>
  );
}
