import { DatabaseIcon, PlusIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ColumnInfo, DatabaseKind, TableInfo } from "@/lib/db";
import { identifierStyleForKind, quoteIdentifier } from "@/lib/export";
import { splitSqlStatements, summarizeStatement } from "@/lib/sql-statements";

interface QuerySchemaBrowserProps {
  tables: TableInfo[];
  columns: ColumnInfo[];
  kind: DatabaseKind;
  sql: string;
  loading: boolean;
  error: boolean;
  onRefresh: () => void;
  onInsert: (text: string) => void;
  onJump: (line: number, column: number) => void;
  onClose: () => void;
}

export function QuerySchemaBrowser({
  tables,
  columns,
  kind,
  sql,
  loading,
  error,
  onRefresh,
  onInsert,
  onJump,
  onClose,
}: QuerySchemaBrowserProps) {
  const [tab, setTab] = useState<"schema" | "outline">("schema");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const term = useDeferredValue(search).trim().toLocaleLowerCase();
  const style = identifierStyleForKind(kind);
  const quote = (name: string) => quoteIdentifier(name, style);
  const columnMap = useMemo(() => {
    const map = new Map<string, ColumnInfo[]>();
    for (const column of columns) {
      const key = JSON.stringify([column.schema, column.table]);
      const list = map.get(key) ?? [];
      list.push(column);
      map.set(key, list);
    }
    return map;
  }, [columns]);
  const visible = useMemo(
    () =>
      tables
        .filter(
          (table) =>
            `${table.schema}.${table.name}`.toLocaleLowerCase().includes(term) ||
            columnMap
              .get(JSON.stringify([table.schema, table.name]))
              ?.some((column) => column.name.toLocaleLowerCase().includes(term)),
        )
        .sort((a, b) => a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name)),
    [tables, term, columnMap],
  );
  const statements = useMemo(() => splitSqlStatements(sql, kind).statements, [sql, kind]);
  return (
    <aside className="flex h-full min-h-0 flex-col bg-muted/15" aria-label="Query-Navigator">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
        {(["schema", "outline"] as const).map((id) => (
          <Button
            key={id}
            variant={tab === id ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {id === "schema" ? "Schema" : "Statements"}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label="Navigator schließen"
          onClick={onClose}
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
      {tab === "schema" ? (
        <>
          <div className="flex items-center gap-1 border-b p-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tabellen und Spalten…"
              aria-label="Schema durchsuchen"
              className="h-7 min-w-0 text-xs"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={loading}
              aria-label="Schema aktualisieren"
              onClick={onRefresh}
            >
              <RefreshCwIcon className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {error && (
              <p role="alert" className="p-2 text-xs text-destructive">
                Metadaten konnten nicht vollständig geladen werden. Erneut laden, um es noch einmal
                zu versuchen.
              </p>
            )}
            {loading && !tables.length && (
              <p role="status" className="p-2 text-xs text-muted-foreground">
                Schema wird geladen…
              </p>
            )}
            {!loading && !visible.length && (
              <p className="p-2 text-xs text-muted-foreground">
                {term ? "Keine passenden Tabellen oder Spalten." : "Keine Tabellen verfügbar."}
              </p>
            )}
            {visible.map((table) => {
              const key = JSON.stringify([table.schema, table.name]);
              const isOpen = Boolean(term) || expanded.has(key);
              const qualified = [table.schema, table.name].filter(Boolean).map(quote).join(".");
              const fields = columnMap.get(JSON.stringify([table.schema, table.name])) ?? [];
              return (
                <details
                  key={JSON.stringify([table.schema, table.name])}
                  className="group mb-1 rounded-md open:bg-muted/40"
                  open={isOpen}
                  onToggle={(event) => {
                    const open = event.currentTarget.open;
                    setExpanded((previous) => {
                      if (previous.has(key) === open) return previous;
                      const next = new Set(previous);
                      if (open) next.add(key);
                      else next.delete(key);
                      return next;
                    });
                  }}
                >
                  <summary className="cursor-pointer rounded-md px-2 py-2 text-xs hover:bg-muted focus-visible:outline-ring">
                    <span className="ml-1 font-mono" title={qualified}>
                      {table.name}
                    </span>
                    <span className="ml-2 text-[10px] text-muted-foreground">{table.schema}</span>
                  </summary>
                  {isOpen && (
                    <div className="px-2 pb-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="mb-1 h-6 w-full justify-start gap-1 text-[10px]"
                        onClick={() => onInsert(qualified)}
                      >
                        <PlusIcon className="size-3" />
                        Tabellennamen einfügen
                      </Button>
                      {!fields.length && (
                        <p className="py-2 text-[10px] text-muted-foreground">
                          Keine Spaltenmetadaten verfügbar.
                        </p>
                      )}
                      {fields.map((column) => (
                        <button
                          type="button"
                          key={column.name}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:outline-ring"
                          title={`${column.name} · ${column.data_type} · Einfügen`}
                          onClick={() => onInsert(quote(column.name))}
                        >
                          <span className="min-w-0 flex-1 truncate font-mono">{column.name}</span>
                          <span className="max-w-24 truncate text-[10px] text-muted-foreground">
                            {column.data_type}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </details>
              );
            })}
          </div>
          <div className="flex h-7 shrink-0 items-center gap-2 border-t px-3 text-[10px] text-muted-foreground">
            <DatabaseIcon className="size-3" />
            {visible.length} / {tables.length} Tabellen
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {!statements.length && (
            <p className="p-2 text-xs text-muted-foreground">
              Statements erscheinen hier, sobald du SQL schreibst.
            </p>
          )}
          {statements.map((statement, index) => {
            const summary = summarizeStatement(statement.text);
            const lines = sql.slice(0, statement.start).split("\n");
            return (
              <button
                type="button"
                key={statement.start}
                className="mb-1 block w-full rounded-md p-2 text-left hover:bg-muted focus-visible:outline-ring"
                onClick={() => onJump(lines.length, lines[lines.length - 1].length + 1)}
              >
                <span className="flex justify-between text-[10px] text-muted-foreground">
                  <span>
                    {String(index + 1).padStart(2, "0")} · {summary.kind}
                  </span>
                  <span>Zeile {lines.length}</span>
                </span>
                <span className="mt-1 block truncate font-mono text-xs">{summary.preview}</span>
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}
