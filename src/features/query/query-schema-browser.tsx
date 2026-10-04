import { useVirtualizer } from "@tanstack/react-virtual";
import { DatabaseIcon, PlusIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ColumnInfo, DatabaseKind, TableInfo } from "@/lib/db";
import { identifierStyleForKind, quoteIdentifier } from "@/lib/export";
import { parsePlsqlMembers } from "@/lib/plsql";
import type { SessionView } from "@/lib/session-views";
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
  sessionViews?: SessionView[];
  onRemoveSessionView?: (name: string) => void;
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
  sessionViews = [],
  onRemoveSessionView,
}: QuerySchemaBrowserProps) {
  const [tab, setTab] = useState<"schema" | "outline">("schema");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const schemaScrollRef = useRef<HTMLDivElement>(null);
  const statementScrollRef = useRef<HTMLDivElement>(null);
  const memberScrollRef = useRef<HTMLDivElement>(null);
  const [memberQuery, setMemberQuery] = useState("");
  const [activeMember, setActiveMember] = useState<string | undefined>(undefined);
  const members = useMemo(() => parsePlsqlMembers(sql), [sql]);
  const visibleMembers = useMemo(() => {
    const needle = memberQuery.trim().toUpperCase();
    if (!needle) return members;
    return members.filter((m) => m.name.includes(needle));
  }, [members, memberQuery]);
  const memberVirtualizer = useVirtualizer({
    count: visibleMembers.length,
    getScrollElement: () => memberScrollRef.current,
    estimateSize: () => 28,
    getItemKey: (index) => {
      const member = visibleMembers[index];
      return `${member.kind}:${member.name}:${member.line}`;
    },
    overscan: 10,
    initialRect: { width: 300, height: 600 },
  });
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
  const visible = useMemo(() => {
    if (members.length > 0 || tab !== "schema") return [];
    return tables
      .filter(
        (table) =>
          `${table.schema}.${table.name}`.toLocaleLowerCase().includes(term) ||
          columnMap
            .get(JSON.stringify([table.schema, table.name]))
            ?.some((column) => column.name.toLocaleLowerCase().includes(term)),
      )
      .sort((a, b) => a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name));
  }, [tables, term, columnMap, members.length, tab]);
  const schemaVirtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => schemaScrollRef.current,
    estimateSize: () => 40,
    getItemKey: (index) => JSON.stringify([visible[index].schema, visible[index].name]),
    overscan: 10,
    initialRect: { width: 300, height: 600 },
  });
  const statements = useMemo(() => {
    if (tab !== "outline" || members.length > 0) return [];
    let cursor = 0;
    let line = 1;
    let lastNewline = -1;
    return splitSqlStatements(sql, kind).statements.map((statement) => {
      let newline = sql.indexOf("\n", cursor);
      while (newline >= 0 && newline < statement.start) {
        line += 1;
        lastNewline = newline;
        cursor = newline + 1;
        newline = sql.indexOf("\n", cursor);
      }
      return {
        start: statement.start,
        summary: summarizeStatement(statement.text),
        line,
        column: statement.start - lastNewline,
      };
    });
  }, [sql, kind, tab, members.length]);
  const statementVirtualizer = useVirtualizer({
    count: statements.length,
    getScrollElement: () => statementScrollRef.current,
    estimateSize: () => 57,
    getItemKey: (index) => statements[index].start,
    overscan: 8,
    initialRect: { width: 300, height: 600 },
  });
  if (members.length > 0) {
    return (
      <aside className="flex h-full min-h-0 flex-col bg-muted/15" aria-label="Package-Mitglieder">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2.5">
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Mitglieder
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">{members.length}</span>
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
        {members.length > 8 ? (
          <div className="border-b p-2">
            <Input
              value={memberQuery}
              onChange={(event) => {
                setMemberQuery(event.target.value);
                memberScrollRef.current?.scrollTo({ top: 0 });
              }}
              placeholder="Filtern…"
              aria-label="Mitglieder filtern"
              className="h-7 min-w-0 text-xs"
            />
          </div>
        ) : null}
        <div
          ref={memberScrollRef}
          className="min-h-0 flex-1 overflow-auto p-1.5"
          data-slot="query-member-list"
        >
          {visibleMembers.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">Keine Treffer.</p>
          ) : (
            <div className="relative" style={{ height: memberVirtualizer.getTotalSize() }}>
              {memberVirtualizer.getVirtualItems().map((virtualRow) => {
                const member = visibleMembers[virtualRow.index];
                const active = member.name === activeMember;
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={memberVirtualizer.measureElement}
                    className="absolute top-0 left-0 w-full"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveMember(member.name);
                        onJump(member.line, 1);
                      }}
                      title={`${member.kind} ${member.name} · Zeile ${member.line}`}
                      className={
                        active
                          ? "flex w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-md bg-accent px-2 py-1 text-left text-accent-foreground"
                          : "flex w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-md px-2 py-1 text-left text-foreground/80 hover:bg-accent/60 hover:text-foreground"
                      }
                    >
                      <span className="w-6 shrink-0 font-mono text-[10px] text-muted-foreground">
                        {member.kind === "FUNCTION" ? "fn" : "pr"}
                      </span>
                      <span className="min-w-0 truncate font-mono text-xs">{member.name}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    );
  }
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
              onChange={(event) => {
                setSearch(event.target.value);
                schemaScrollRef.current?.scrollTo({ top: 0 });
              }}
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
          <div
            ref={schemaScrollRef}
            className="min-h-0 flex-1 overflow-auto p-2"
            data-slot="query-schema-list"
          >
            {error && (
              <p role="alert" className="p-2 text-xs text-destructive">
                Metadaten konnten nicht vollständig geladen werden. Erneut laden, um es noch einmal
                zu versuchen.
              </p>
            )}
            {sessionViews.length > 0 && (
              <section
                aria-label="Sitzungs-Views"
                className="mb-2 rounded-md border border-dashed p-1.5"
              >
                <p className="px-1 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  Sitzungs-Views
                </p>
                {sessionViews.map((view) => (
                  <div key={view.name} className="flex items-center gap-1">
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left font-mono text-xs hover:bg-muted"
                      title={view.sql}
                      onClick={() => onInsert(view.name)}
                    >
                      {view.name}
                    </button>
                    {onRemoveSessionView && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Sitzungs-View ${view.name} entfernen`}
                        onClick={() => onRemoveSessionView(view.name)}
                      >
                        <XIcon className="size-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </section>
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
            <div className="relative" style={{ height: schemaVirtualizer.getTotalSize() }}>
              {schemaVirtualizer.getVirtualItems().map((virtualRow) => {
                const table = visible[virtualRow.index];
                const key = JSON.stringify([table.schema, table.name]);
                const isOpen = Boolean(term) || expanded.has(key);
                const qualified = [table.schema, table.name].filter(Boolean).map(quote).join(".");
                const fields = columnMap.get(JSON.stringify([table.schema, table.name])) ?? [];
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={schemaVirtualizer.measureElement}
                    className="absolute top-0 left-0 w-full pb-1"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <details
                      className="group rounded-md open:bg-muted/40"
                      open={isOpen}
                      onToggle={(event) => {
                        if (term) return;
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
                        <span className="ml-2 text-[10px] text-muted-foreground">
                          {table.schema}
                        </span>
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
                              <span className="min-w-0 flex-1 truncate font-mono">
                                {column.name}
                              </span>
                              <span className="max-w-24 truncate text-[10px] text-muted-foreground">
                                {column.data_type}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </details>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex h-7 shrink-0 items-center gap-2 border-t px-3 text-[10px] text-muted-foreground">
            <DatabaseIcon className="size-3" />
            {visible.length} / {tables.length} Tabellen
          </div>
        </>
      ) : (
        <div
          ref={statementScrollRef}
          className="min-h-0 flex-1 overflow-auto p-2"
          data-slot="query-statement-list"
        >
          {!statements.length && (
            <p className="p-2 text-xs text-muted-foreground">
              Statements erscheinen hier, sobald du SQL schreibst.
            </p>
          )}
          <div className="relative" style={{ height: statementVirtualizer.getTotalSize() }}>
            {statementVirtualizer.getVirtualItems().map((virtualRow) => {
              const statement = statements[virtualRow.index];
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={statementVirtualizer.measureElement}
                  className="absolute top-0 left-0 w-full pb-1"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <button
                    type="button"
                    className="block w-full rounded-md p-2 text-left hover:bg-muted focus-visible:outline-ring"
                    onClick={() => onJump(statement.line, statement.column)}
                  >
                    <span className="flex justify-between text-[10px] text-muted-foreground">
                      <span>
                        {String(virtualRow.index + 1).padStart(2, "0")} · {statement.summary.kind}
                      </span>
                      <span>Zeile {statement.line}</span>
                    </span>
                    <span className="mt-1 block truncate font-mono text-xs">
                      {statement.summary.preview}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
