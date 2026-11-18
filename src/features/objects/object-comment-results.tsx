import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ColumnsIcon, TableIcon } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  LOADED_COMMENT_TERM_LIMIT,
  type LoadedCommentScope,
  matchLoadedObjectComments,
  observeLoadedObjectComments,
} from "@/lib/loaded-object-comments";

export function ObjectCommentResults({
  connectionId,
  database,
  schema,
  allowedSchemas,
  term,
  close,
}: LoadedCommentScope & { term: string; close: () => void }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const store = useMemo(
    () => observeLoadedObjectComments(client, { connectionId, database, schema, allowedSchemas }),
    [client, connectionId, database, schema, allowedSchemas],
  );
  const index = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { matches, more } = useMemo(
    () => matchLoadedObjectComments(index.entries, term),
    [index, term],
  );
  return (
    <ScrollArea className="mt-2 h-80">
      <div role="status" className="px-2 py-1 text-xs text-muted-foreground">
        {term.trim().length > LOADED_COMMENT_TERM_LIMIT
          ? `Maximal ${LOADED_COMMENT_TERM_LIMIT} Zeichen für die Kommentarsuche.`
          : term.trim().length >= 2 && !matches.length
            ? "Keine passenden geladenen Kommentare."
            : null}
        {more ? "Erste 60 Treffer. Suchtext eingrenzen." : null}
        {index.limited ? " Der Suchumfang ist begrenzt." : null}
      </div>
      <ul aria-label="Kommentartreffer" className="flex flex-col gap-1">
        {matches.map(({ entry, excerpt }) => (
          <li key={entry.key}>
            <button
              type="button"
              className="flex w-full min-w-0 flex-col gap-1 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
              onClick={() => {
                if (entry.expiresAt <= Date.now() || !store.getSnapshot().entries.includes(entry))
                  return;
                close();
                void navigate({
                  to: "/tables/$schema/$table",
                  params: { schema: entry.schema, table: entry.table },
                  search: { column: entry.column },
                });
              }}
            >
              <span className="flex w-full min-w-0 items-center gap-2">
                {entry.column ? (
                  <ColumnsIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <TableIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">
                  {entry.schema}.{entry.table}
                  {entry.column ? ` · ${entry.column}` : ""}
                </span>
                <Badge variant="secondary" className="shrink-0">
                  {entry.column ? "Spaltenkommentar" : "Tabellenkommentar"}
                </Badge>
              </span>
              <span className="w-full truncate pl-6 text-xs text-muted-foreground">{excerpt}</span>
            </button>
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}
