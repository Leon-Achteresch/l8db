import type { UseQueryResult } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DatabaseListPage } from "@/lib/db/supabase-studio-database";
import { PAGE_SIZE } from "./use-database-list";

interface Props<T> {
  list: {
    query: UseQueryResult<DatabaseListPage<T>>;
    search: string;
    setSearch: (value: string) => void;
    offset: number;
    setOffset: (value: number) => void;
  };
  toolbar?: ReactNode;
  empty: string;
  children: (items: T[]) => ReactNode;
}

export function DatabaseListFrame<T>({ list, toolbar, empty, children }: Props<T>) {
  const { query, search, setSearch, offset, setOffset } = list;
  const items = query.data?.items ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute top-2 left-2 size-4 text-muted-foreground" />
          <Input
            className="h-8 pl-8 text-xs"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Suchen…"
            aria-label="Suchen"
          />
        </div>
        {toolbar}
      </div>
      {query.isError ? (
        <p role="alert" className="text-xs text-destructive">
          {String(query.error)}
        </p>
      ) : query.isPending ? (
        <p className="text-xs text-muted-foreground">Wird geladen…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">{children(items)}</div>
      )}
      {(offset > 0 || query.data?.has_more) && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <span>
            {offset + 1}–{offset + items.length}
          </span>
          <Button
            size="icon-xs"
            variant="outline"
            aria-label="Vorherige Seite"
            disabled={offset === 0 || query.isFetching}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            <ChevronLeft />
          </Button>
          <Button
            size="icon-xs"
            variant="outline"
            aria-label="Nächste Seite"
            disabled={!query.data?.has_more || query.isFetching}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}
