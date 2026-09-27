import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AppwritePage } from "@/lib/db";

interface ResourceItem {
  id: string;
  name: string;
}

export function AppwriteResourceCard<T extends ResourceItem>({
  id,
  kind,
  title,
  icon,
  load,
  detail,
}: {
  id: string;
  kind: string;
  title: string;
  icon: ReactNode;
  load: (id: string, offset: number) => Promise<AppwritePage<T>>;
  detail: (item: T) => string;
}) {
  const [offset, setOffset] = useState(0);
  const resources = useQuery({
    queryKey: ["appwrite", id, kind, offset],
    queryFn: () => load(id, offset),
  });

  return (
    <section className="min-w-0 rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold">{title}</h3>
        {resources.data && (
          <span className="ml-auto text-xs text-muted-foreground">{resources.data.total}</span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${title} aktualisieren`}
          onClick={() => void resources.refetch()}
          disabled={resources.isFetching}
        >
          <RefreshCw className={`size-3.5 ${resources.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {resources.isPending ? (
        <p className="mt-5 text-xs text-muted-foreground">Wird geladen…</p>
      ) : resources.isError ? (
        <p role="alert" className="mt-5 text-xs text-destructive">
          {String(resources.error)}
        </p>
      ) : resources.data.items.length === 0 ? (
        <p className="mt-5 text-xs text-muted-foreground">Keine Einträge vorhanden.</p>
      ) : (
        <div className="mt-4 divide-y">
          {resources.data.items.map((item) => (
            <div key={item.id} className="py-3 first:pt-0">
              <p className="truncate text-xs font-medium" title={item.name || item.id}>
                {item.name || item.id}
              </p>
              <p className="mt-1 truncate text-[11px] text-muted-foreground" title={detail(item)}>
                {detail(item)}
              </p>
            </div>
          ))}
        </div>
      )}
      {resources.data &&
        (offset > 0 || offset + resources.data.items.length < resources.data.total) && (
          <div className="mt-4 flex items-center justify-end gap-2 border-t pt-3">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={`${title}: vorherige Seite`}
              disabled={offset === 0}
              onClick={() => setOffset((value) => Math.max(0, value - 100))}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <span className="text-xs text-muted-foreground">
              {offset + 1}–{offset + resources.data.items.length} / {resources.data.total}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={`${title}: nächste Seite`}
              disabled={offset + resources.data.items.length >= resources.data.total}
              onClick={() => setOffset((value) => value + 100)}
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        )}
    </section>
  );
}
