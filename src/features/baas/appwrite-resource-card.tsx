import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { type ReactNode, type Ref, useState } from "react";
import { NewBadge } from "@/components/new-badge";
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
  renderDetails,
  detailsRef,
  detailsNew,
  headerAction,
  renderActions,
}: {
  id: string;
  kind: string;
  title: string;
  icon: ReactNode;
  load: (id: string, offset: number) => Promise<AppwritePage<T>>;
  detail: (item: T) => string;
  renderDetails?: (item: T) => ReactNode;
  detailsRef?: Ref<HTMLDivElement>;
  detailsNew?: boolean;
  headerAction?: ReactNode;
  renderActions?: (item: T, index: number) => ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
      {headerAction}
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
          {resources.data.items.map((item, index) => (
            <div key={item.id} className="py-3 first:pt-0">
              {renderDetails ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 text-left text-xs font-medium hover:text-primary"
                  aria-expanded={expandedId === item.id}
                  onClick={() => setExpandedId((current) => (current === item.id ? null : item.id))}
                >
                  <span className="min-w-0 flex-1 truncate" title={item.name || item.id}>
                    {item.name || item.id}
                  </span>
                  {detailsNew && index === 0 && <NewBadge />}
                  <ChevronDown
                    className={`size-3.5 shrink-0 transition-transform ${expandedId === item.id ? "rotate-180" : ""}`}
                  />
                </button>
              ) : (
                <p className="truncate text-xs font-medium" title={item.name || item.id}>
                  {item.name || item.id}
                </p>
              )}
              <p className="mt-1 truncate text-[11px] text-muted-foreground" title={detail(item)}>
                {detail(item)}
              </p>
              {renderActions?.(item, index)}
              {renderDetails && expandedId === item.id && (
                <div ref={detailsRef} className="mt-3 rounded-lg bg-muted/40 p-3">
                  {renderDetails(item)}
                </div>
              )}
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
              onClick={() => {
                setOffset((value) => Math.max(0, value - 100));
                setExpandedId(null);
              }}
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
              onClick={() => {
                setOffset((value) => value + 100);
                setExpandedId(null);
              }}
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        )}
    </section>
  );
}
