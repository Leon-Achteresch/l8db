import { ChevronLeftIcon, ChevronRightIcon, LinkIcon, Loader2Icon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useActiveConnection } from "@/lib/connections";
import { fetchTableRows } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import {
  buildFkSearchFilter,
  FK_LOOKUP_PAGE_SIZE,
  type FkTarget,
  fkLabelColumns,
  fkOptionLabel,
  fkOptionValue,
  fkPageOffset,
  hasMoreFkRows,
} from "@/lib/fk-lookup";
import { effectiveConnectionString } from "@/lib/ssh";
import { cn } from "@/lib/utils";

type FkValuePickerDialogProps = {
  columnName: string;
  target: FkTarget;
  currentValue: string | null;
  allowNull: boolean;
  isSaving: boolean;
  onSelect: (value: string | null) => Promise<void>;
  onClose: () => void;
};

export function FkValuePickerDialog({
  columnName,
  target,
  currentValue,
  allowNull,
  isSaving,
  onSelect,
  onClose,
}: FkValuePickerDialogProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const labelColumnKey = useMemo(
    () => fkLabelColumns(columns, target.keyColumn).join("\u0000"),
    [columns, target.keyColumn],
  );
  const labelColumns = useMemo(
    () => (labelColumnKey === "" ? [] : labelColumnKey.split("\u0000")),
    [labelColumnKey],
  );

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    const filter = buildFkSearchFilter(target.keyColumn, labelColumns, debounced, connection.kind);
    fetchTableRows(
      connection.kind,
      effectiveConnectionString(connection),
      target.schema,
      target.table,
      filter,
      FK_LOOKUP_PAGE_SIZE,
      fkPageOffset(page),
      database ?? undefined,
    )
      .then((result) => {
        if (cancelled) return;
        setColumns(result.columns.filter((col) => col !== "__ctid__"));
        setRows(result.rows as Record<string, unknown>[]);
      })
      .catch((err) => {
        if (cancelled) return;
        setRows([]);
        setError(typeof err === "string" ? err : String(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    connection,
    database,
    target.schema,
    target.table,
    target.keyColumn,
    debounced,
    page,
    labelColumns,
  ]);

  const hasMore = hasMoreFkRows(rows.length);

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl sm:max-w-xl border border-border bg-popover shadow-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <LinkIcon className="size-4 text-blue-500" />
            <span className="font-mono text-primary font-bold">{columnName}</span>
            <span className="text-xs font-normal text-muted-foreground font-mono">
              → {target.schema}.{target.table}.{target.keyColumn}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <div className="relative">
            <SearchIcon className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Suchen…"
              className="h-8 pl-7 text-xs"
            />
          </div>
          <div className="min-h-64 max-h-[50vh] overflow-auto rounded-md border border-border/80">
            {isLoading ? (
              <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
                <Loader2Icon className="size-3 animate-spin" />
                Lade…
              </div>
            ) : error ? (
              <div className="px-3 py-4 text-xs text-destructive font-mono">{error}</div>
            ) : rows.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground">Keine Treffer.</div>
            ) : (
              rows.map((row) => {
                const value = fkOptionValue(row, target.keyColumn);
                const rowKey = String(row.__ctid__ ?? value ?? "null");
                const label = fkOptionLabel(row, target.keyColumn, labelColumns);
                const isCurrent = value !== null && value === currentValue;
                return (
                  <button
                    key={rowKey}
                    type="button"
                    disabled={value === null || isSaving}
                    onClick={() => void onSelect(value)}
                    className={cn(
                      "flex w-full items-center gap-3 border-b border-border/40 px-3 py-1.5 text-left transition-colors last:border-b-0 hover:bg-muted/50 disabled:opacity-50 cursor-pointer",
                      isCurrent && "bg-primary/10",
                    )}
                  >
                    <span className="shrink-0 font-mono text-xs font-semibold text-primary">
                      {value ?? "NULL"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {label}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!allowNull || isSaving}
                title={allowNull ? undefined : "Spalte ist NOT NULL"}
                onClick={() => void onSelect(null)}
              >
                Auf NULL setzen
              </Button>
              {isSaving && <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />}
            </div>
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="mr-1">Seite {page + 1}</span>
              <button
                type="button"
                disabled={page === 0 || isLoading}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="inline-flex size-6 items-center justify-center rounded hover:bg-accent disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              >
                <ChevronLeftIcon className="size-3.5" />
              </button>
              <button
                type="button"
                disabled={!hasMore || isLoading}
                onClick={() => setPage((p) => p + 1)}
                className="inline-flex size-6 items-center justify-center rounded hover:bg-accent disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              >
                <ChevronRightIcon className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
