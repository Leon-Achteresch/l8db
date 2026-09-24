import { ExternalLinkIcon, LinkIcon, Loader2Icon, PinIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useActiveConnection } from "@/lib/connections";
import { type ForeignKeyInfo, fetchTableRows } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { fkPreviewKey, useFkPreviewPrefs } from "@/lib/fk-preview-prefs";
import { effectiveConnectionString } from "@/lib/ssh";
import { tableCellPreview } from "@/lib/table-cell-preview";
import { fkLinksFor, formatFkFilter } from "./fk-links";

export function FkPreviewPopover({
  fks,
  column,
  value,
  currentSchema,
  currentTable,
  onNavigate,
  children,
}: {
  fks: ForeignKeyInfo[];
  column: string;
  value: unknown;
  currentSchema: string;
  currentTable: string;
  onNavigate: (schema: string, table: string, filter?: string, inTab?: boolean) => void;
  children: React.ReactNode;
}) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const [previewData, setPreviewData] = useState<Record<string, unknown> | null>(null);
  const [previewColumns, setPreviewColumns] = useState<string[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const links = useMemo(
    () => fkLinksFor(fks, currentSchema, currentTable, column),
    [fks, currentSchema, currentTable, column],
  );
  const primary = links[0];
  const isSingle = links.length === 1;
  const [expanded, setExpanded] = useState(false);
  const pinKey =
    connection && primary ? fkPreviewKey(connection.id, primary.schema, primary.table) : "";
  const pinned = useFkPreviewPrefs((state) => state.pinned[pinKey]);
  const togglePinned = useFkPreviewPrefs((state) => state.togglePinned);
  const orderedColumns = useMemo(() => {
    if (!pinned?.length) return previewColumns;
    const pinnedSet = new Set(pinned);
    return [
      ...pinned.filter((c) => previewColumns.includes(c)),
      ...previewColumns.filter((c) => !pinnedSet.has(c)),
    ];
  }, [previewColumns, pinned]);
  const collapsedCount = pinned?.length
    ? orderedColumns.filter((c) => pinned.includes(c)).length || 8
    : 8;
  const visibleColumns = expanded ? orderedColumns : orderedColumns.slice(0, collapsedCount);

  const handleOpenChange = (open: boolean) => {
    if (!open || hasLoaded || !connection || !primary || !isSingle) return;
    if (value === null || value === undefined) return;
    setIsLoadingPreview(true);
    setHasLoaded(true);
    const filterSql = formatFkFilter(primary.column, value);
    fetchTableRows(
      connection.kind,
      effectiveConnectionString(connection),
      primary.schema,
      primary.table,
      filterSql,
      5,
      0,
      database ?? undefined,
    )
      .then((result) => {
        setPreviewColumns(result.columns);
        setPreviewData((result.rows[0] as Record<string, unknown>) ?? null);
      })
      .catch(() => {
        setPreviewData(null);
      })
      .finally(() => setIsLoadingPreview(false));
  };

  const handleModifierClick = (e: React.MouseEvent) => {
    if (!(e.ctrlKey || e.metaKey || e.altKey) || value === null || value === undefined) return;
    if (!primary || !isSingle) return;
    e.preventDefault();
    e.stopPropagation();
    onNavigate(primary.schema, primary.table, formatFkFilter(primary.column, value));
  };

  if (value === null || value === undefined || !primary) {
    return <>{children}</>;
  }

  return (
    <HoverCard openDelay={400} closeDelay={100} onOpenChange={handleOpenChange}>
      <HoverCardTrigger asChild>
        <div
          onClick={handleModifierClick}
          onContextMenu={(e) => {
            if (e.ctrlKey) handleModifierClick(e);
          }}
          className="flex h-5 w-fit items-center gap-1 min-w-0 max-w-full cursor-pointer group/fk"
        >
          <LinkIcon className="size-3 shrink-0 text-blue-500/60 fk-hover:text-blue-500 transition-colors" />
          <div className="truncate">{children}</div>
        </div>
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="start"
        className="w-auto min-w-72 max-w-[32rem] p-0"
        onClick={(e) => e.stopPropagation()}
      >
        {isSingle ? (
          <>
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2 bg-muted/40">
              <div className="flex items-center gap-1.5 min-w-0">
                <ExternalLinkIcon className="size-3 shrink-0 text-blue-500" />
                <span className="font-mono text-[11px] font-semibold text-foreground/80 truncate">
                  {primary.schema}.{primary.table}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
                {primary.isOutgoing ? "FK" : "Referenced by"}
              </span>
            </div>
            <div className="px-3 py-2 max-h-52 overflow-auto">
              {isLoadingPreview ? (
                <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                  <Loader2Icon className="size-3 animate-spin" />
                  Lade...
                </div>
              ) : previewData ? (
                <div className="space-y-1">
                  {visibleColumns.map((col) => {
                    const isPinned = pinned?.includes(col) ?? false;
                    return (
                      <div key={col} className="group/row flex items-baseline gap-2 text-xs">
                        <span className="shrink-0 font-mono font-semibold text-muted-foreground w-24 truncate text-right">
                          {col}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {tableCellPreview(previewData[col]).text}
                        </span>
                        <button
                          type="button"
                          title={isPinned ? "Lösen" : "Anpinnen"}
                          className={`shrink-0 self-center cursor-pointer transition-opacity ${isPinned ? "text-blue-500 opacity-70 hover:opacity-100" : "text-muted-foreground opacity-0 row-hover:opacity-60 hover:opacity-100!"}`}
                          onClick={() => togglePinned(pinKey, col)}
                        >
                          <PinIcon className={`size-3 ${isPinned ? "fill-current" : ""}`} />
                        </button>
                      </div>
                    );
                  })}
                  {orderedColumns.length > collapsedCount && (
                    <button
                      type="button"
                      className="text-[10px] text-muted-foreground hover:text-foreground pt-1 cursor-pointer"
                      onClick={() => setExpanded((v) => !v)}
                    >
                      {expanded
                        ? "Weniger anzeigen"
                        : `+${orderedColumns.length - collapsedCount} weitere Spalten`}
                    </button>
                  )}
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">Kein Eintrag gefunden.</span>
              )}
            </div>
            <div className="border-t px-3 py-1.5 bg-muted/20">
              <button
                type="button"
                className="text-[11px] text-blue-500 hover:text-blue-600 font-medium cursor-pointer transition-colors"
                onClick={() =>
                  onNavigate(
                    primary.schema,
                    primary.table,
                    formatFkFilter(primary.column, value),
                    true,
                  )
                }
              >
                In {primary.schema}.{primary.table} anzeigen
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2 bg-muted/40">
              <div className="flex items-center gap-1.5 min-w-0">
                <ExternalLinkIcon className="size-3 shrink-0 text-blue-500" />
                <span className="font-mono text-[11px] font-semibold text-foreground/80 truncate">
                  {links.length} Verknüpfungen
                </span>
              </div>
            </div>
            <div className="max-h-52 overflow-auto py-1">
              {links.map((link) => (
                <button
                  key={`${link.isOutgoing}|${link.schema}.${link.table}.${link.column}`}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-muted/60 cursor-pointer transition-colors"
                  onClick={() =>
                    onNavigate(link.schema, link.table, formatFkFilter(link.column, value), true)
                  }
                >
                  <span className="min-w-0 truncate font-mono text-[11px]">
                    {link.schema}.{link.table}.{link.column}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {link.isOutgoing ? "FK" : "Referenced by"}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
