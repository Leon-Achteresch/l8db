import { useNavigate } from "@tanstack/react-router";
import { ColumnsIcon, EyeIcon, Loader2Icon, SearchIcon, TableIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useActiveConnection } from "@/lib/connections";
import { countTableRows } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { useColumnsQuery, useTablesQuery, useViewsQuery } from "@/lib/queries";
import { compileContentFilter } from "@/lib/sql-filter";
import { effectiveConnectionString } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";

interface Candidate {
  schema: string;
  name: string;
  type: "table" | "view";
  columns: string[];
}

interface Hit extends Candidate {
  count: number | null;
  error?: string;
  filter: string;
}

const CONCURRENCY = 4;

export function TableContentSearch({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const openTab = useTableTabs((state) => state.openTab);
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const { data: tables } = useTablesQuery();
  const { data: views } = useViewsQuery();
  const { data: tableColumns } = useColumnsQuery("BASE TABLE");
  const { data: viewColumns } = useColumnsQuery("VIEW");

  const [columnQuery, setColumnQuery] = useState("");
  const [value, setValue] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const runRef = useRef(0);

  useEffect(
    () => () => {
      runRef.current += 1;
    },
    [],
  );

  const candidates = useMemo<Candidate[]>(() => {
    const q = columnQuery.trim().toLowerCase();
    const byKey = new Map<string, Candidate>();
    for (const t of tables ?? [])
      byKey.set(`table:${t.schema}.${t.name}`, { ...t, type: "table", columns: [] });
    for (const v of views ?? [])
      byKey.set(`view:${v.schema}.${v.name}`, { ...v, type: "view", columns: [] });
    const add = (type: "table" | "view", cols: typeof tableColumns) => {
      for (const c of cols ?? []) {
        if (q && !c.name.toLowerCase().includes(q)) continue;
        byKey.get(`${type}:${c.schema}.${c.table}`)?.columns.push(c.name);
      }
    };
    add("table", tableColumns);
    add("view", viewColumns);
    return [...byKey.values()].filter((c) => c.columns.length > 0);
  }, [tables, views, tableColumns, viewColumns, columnQuery]);

  const running = progress !== null && progress.done < progress.total;
  const valueTrimmed = value.trim();

  const run = async () => {
    if (!connection || !valueTrimmed) return;
    const runId = ++runRef.current;
    const connStr = effectiveConnectionString(connection);
    const found: Hit[] = [];
    setHits([]);
    setProgress({ done: 0, total: candidates.length });
    let index = 0;
    let done = 0;
    const worker = async () => {
      while (index < candidates.length && runRef.current === runId) {
        const c = candidates[index++];
        const filter = compileContentFilter(c.columns, valueTrimmed, connection.kind);
        let hit: Hit | null = null;
        try {
          const count = await countTableRows(
            connection.kind,
            connStr,
            c.schema,
            c.name,
            filter,
            database ?? undefined,
            false,
          );
          if (count > 0) hit = { ...c, count, filter };
        } catch (e) {
          hit = { ...c, count: null, error: e instanceof Error ? e.message : String(e), filter };
        }
        if (runRef.current !== runId) return;
        done += 1;
        if (hit) {
          found.push(hit);
          setHits([...found]);
        }
        setProgress({ done, total: candidates.length });
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  };

  const stop = () => {
    runRef.current += 1;
    setProgress((p) => (p ? { ...p, total: p.done } : null));
  };

  const reset = () => {
    runRef.current += 1;
    setHits([]);
    setProgress(null);
  };

  const open = (hit: Hit) => {
    openTab({ schema: hit.schema, table: hit.name, entityType: hit.type });
    onClose();
    void navigate({
      to: "/tables/$schema/$table",
      params: { schema: hit.schema, table: hit.name },
      search: { type: hit.type, ...(hit.count ? { fkFilter: hit.filter } : {}) },
    });
  };

  const list: Hit[] =
    valueTrimmed && progress ? hits : candidates.map((c) => ({ ...c, count: null, filter: "" }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <ColumnsIcon className="size-4 shrink-0 text-muted-foreground" />
        <Input
          placeholder="Spalte (optional, alle wenn leer)"
          value={columnQuery}
          onChange={(e) => {
            reset();
            setColumnQuery(e.target.value);
          }}
          className="h-7 text-xs"
        />
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <Input
          placeholder="Wert (enthält)"
          value={value}
          onChange={(e) => {
            reset();
            setValue(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !running) void run();
          }}
          className="h-7 text-xs"
          autoFocus
        />
        {running ? (
          <Button type="button" size="xs" variant="outline" onClick={stop}>
            <XIcon />
            Stopp
          </Button>
        ) : (
          <Button
            type="button"
            size="xs"
            onClick={() => void run()}
            disabled={!valueTrimmed || candidates.length === 0}
          >
            <SearchIcon />
            Suchen
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        {running && <Loader2Icon className="size-3 animate-spin" />}
        <span>
          {progress && valueTrimmed
            ? `${progress.done}/${progress.total} durchsucht · ${hits.length} Treffer`
            : `${candidates.length} Tabellen & Views mit passender Spalte`}
        </span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="py-1">
          {list.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">Keine Treffer</p>
          ) : (
            list.map((hit) => (
              <button
                key={`${hit.type}:${hit.schema}.${hit.name}`}
                type="button"
                onClick={() => open(hit)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted/80",
                  hit.error && "text-destructive",
                )}
                title={hit.error ?? hit.columns.join(", ")}
              >
                {hit.type === "table" ? (
                  <TableIcon className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <EyeIcon className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {hit.schema}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{hit.name}</span>
                <span className="truncate text-[10px] text-muted-foreground">
                  {hit.columns.slice(0, 3).join(", ")}
                  {hit.columns.length > 3 ? ` +${hit.columns.length - 3}` : ""}
                </span>
                {hit.count !== null && (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {hit.count}
                  </Badge>
                )}
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
