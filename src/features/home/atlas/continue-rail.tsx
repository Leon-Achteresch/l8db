import { Eye, History, Star, Table2 } from "lucide-react";
import { useMemo } from "react";
import { useQueryHistoryStore } from "@/lib/query-history";
import { cn } from "@/lib/utils";
import { selectActivity } from "../activity";
import { RecentQueries } from "../connected-dashboard/recent-queries";
import { formatAgo } from "./atlas-format";
import type { TrailEntry } from "./use-atlas-trail";

interface ContinueRailProps {
  connectionId: string;
  database: string | null;
  schema: string;
  entries: TrailEntry[];
  onSpotlight: (key: string | null) => void;
  onOpen: (schema: string, name: string, view: boolean) => void;
}

export function ContinueRail({
  connectionId,
  database,
  schema,
  entries,
  onSpotlight,
  onOpen,
}: ContinueRailProps) {
  const history = useQueryHistoryStore((state) => state.entries);
  const activity = useMemo(
    () => selectActivity(history, connectionId, database, Date.now()),
    [history, connectionId, database],
  );
  const now = Date.now();

  return (
    <aside aria-label="Weitermachen" className="flex min-h-0 flex-col gap-6">
      <section className="shrink-0">
        <h2 className="eyebrow mb-2">Weitermachen</h2>
        {entries.length ? (
          <ul onPointerLeave={() => onSpotlight(null)}>
            {entries.map((entry) => {
              const here = entry.schema === schema;
              return (
                <li key={entry.key}>
                  <button
                    type="button"
                    onClick={() => onOpen(entry.schema, entry.name, entry.view)}
                    onPointerEnter={() => onSpotlight(here ? entry.key : null)}
                    onFocus={() => onSpotlight(here ? entry.key : null)}
                    onBlur={() => onSpotlight(null)}
                    className="group -mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none"
                  >
                    {entry.state === "favorite" ? (
                      <Star className="size-3.5 shrink-0 fill-current text-primary" />
                    ) : entry.view ? (
                      <Eye className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <Table2
                        className={cn(
                          "size-3.5 shrink-0",
                          entry.state === "open" ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                      {!here && <span className="text-muted-foreground">{entry.schema}.</span>}
                      {entry.name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {entry.state === "open"
                        ? "offen"
                        : entry.state === "closed" && entry.at
                          ? formatAgo(entry.at, now)
                          : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
            <History className="mt-0.5 size-3.5 shrink-0" />
            Tabellen, die du öffnest oder favorisierst, erscheinen hier und auf der Karte.
          </p>
        )}
      </section>
      <div className="min-h-0 flex-1">
        <RecentQueries recent={activity.recent} activity={activity} />
      </div>
    </aside>
  );
}
