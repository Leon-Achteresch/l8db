import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, FilterIcon } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { type CatalogObject, listTables, loadSchemaCatalog } from "@/lib/db";
import { prepareConnection } from "@/lib/prepare-connection";
import { compareTypesFor } from "@/lib/schema-compare/types";
import { effectiveConnectionString } from "@/lib/ssh";
import { objectKey, PICKABLE_LABELS, pickableObjects } from "@/lib/transfer/native-script";
import { cn } from "@/lib/utils";
import { type TransferPickItem, TransferTableList } from "./transfer-table-list";

const GROUPS: Record<string, string> = {
  table: "Tabellen",
  view: "Views",
  materialized_view: "Materialized Views",
  sequence: "Sequenzen",
  function: "Funktionen",
  procedure: "Prozeduren",
  package: "Packages",
  type: "Typen",
  synonym: "Synonyme",
  trigger: "Trigger",
};
const ORDER = Object.keys(GROUPS);

async function loadObjects(
  connectionId: string,
  database: string | null,
  schema: string,
  withObjects: boolean,
): Promise<TransferPickItem[]> {
  const ready = await prepareConnection(connectionId);
  const url = effectiveConnectionString(ready);
  const types = compareTypesFor(ready.kind).filter(
    (type) => type !== "table" && type in PICKABLE_LABELS,
  );
  const [tables, catalog] = await Promise.all([
    listTables(ready.kind, url, database ?? undefined, schema),
    withObjects && types.length > 0
      ? loadSchemaCatalog(ready.kind, url, schema, types, database ?? undefined)
      : ([] as CatalogObject[]),
  ]);
  const items = [
    ...tables.map((table) => ({ key: `table:${table.name}`, name: table.name, type: "table" })),
    ...new Map(
      pickableObjects(catalog).map((object) => [
        objectKey(object),
        {
          key: objectKey(object),
          name: object.parent ? `${object.parent}.${object.name}` : object.name,
          type: object.object_type,
        },
      ]),
    ).values(),
  ];
  return items.sort(
    (a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || a.name.localeCompare(b.name),
  );
}

export function TransferTablePicker({
  connectionId,
  database,
  schema,
  total,
  selected,
  objects: pickedObjects,
  withObjects,
  onChange,
  onObjects,
}: {
  connectionId: string;
  database: string | null;
  schema: string;
  total: number | null;
  selected: string[] | undefined;
  objects: string[] | undefined;
  withObjects: boolean;
  onChange: (value: string[] | null) => void;
  onObjects: (value: string[] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const loaded = useQuery({
    queryKey: ["transfer-objects", connectionId, database, schema, withObjects],
    enabled: open,
    retry: false,
    staleTime: 60_000,
    queryFn: () => loadObjects(connectionId, database, schema, withObjects),
  });
  const all = loaded.data ?? [];
  const tableNames = all.filter((item) => item.type === "table").map((item) => item.name);
  const objectKeys = all.filter((item) => item.type !== "table").map((item) => item.key);
  const needle = query.trim().toLowerCase();
  const matches = needle ? all.filter((item) => item.name.toLowerCase().includes(needle)) : all;
  const visible = matches.flatMap((item, index) =>
    index === 0 || matches[index - 1].type !== item.type
      ? [
          {
            key: `group:${item.type}`,
            name: GROUPS[item.type] ?? item.type,
            type: item.type,
            header: true,
          },
          item,
        ]
      : [item],
  );
  const chosen = new Set([
    ...(selected ?? tableNames).map((name) => `table:${name}`),
    ...objectKeys.filter((key) => !pickedObjects?.includes(key)),
  ]);
  const count = loaded.data ? all.filter((item) => chosen.has(item.key)).length : null;
  const known = loaded.data ? all.length : total;
  const commit = (next: Set<string>) => {
    onChange(
      tableNames.every((name) => next.has(`table:${name}`))
        ? null
        : tableNames.filter((name) => next.has(`table:${name}`)),
    );
    const skipped = objectKeys.filter((key) => !next.has(key));
    onObjects(skipped.length > 0 ? skipped : null);
  };
  const toggle = (key: string) => {
    const next = new Set(chosen);
    const on = !next.has(key);
    const triggers = key.startsWith("table:") ? `trigger:${key.slice(6)}.` : null;
    for (const item of all)
      if (item.key === key || (triggers && item.key.startsWith(triggers))) {
        if (on) next.add(item.key);
        else next.delete(item.key);
      }
    commit(next);
  };
  const partial = Boolean(selected || pickedObjects);
  const label = partial
    ? count === null
      ? "Teilauswahl"
      : `${count.toLocaleString("de-DE")} von ${known?.toLocaleString("de-DE") ?? "?"}`
    : known === null
      ? "Alle"
      : `Alle ${known.toLocaleString("de-DE")}`;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger
        aria-label={`Tabellen aus ${schema}`}
        className={cn(
          "ml-auto flex h-7 max-w-full items-center gap-1 rounded-md border px-2 text-xs tabular-nums hover:bg-muted",
          partial && "border-primary/40 bg-primary/5 text-primary",
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-2 p-2">
        <div className="relative">
          <FilterIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            placeholder={withObjects ? "Objekte filtern" : "Tabellen filtern"}
            aria-label={withObjects ? "Objekte filtern" : "Tabellen filtern"}
            className="h-8 pl-8 text-xs md:text-xs"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {loaded.isPending ? (
          <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            {withObjects ? "Objekte werden geladen…" : "Tabellen werden geladen…"}
          </p>
        ) : loaded.isError ? (
          <p role="alert" className="px-2 py-4 text-xs text-destructive">
            {loaded.error instanceof Error ? loaded.error.message : String(loaded.error)}
          </p>
        ) : visible.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            {all.length === 0 ? "Keine Objekte." : "Keine Treffer."}
          </p>
        ) : (
          <TransferTableList schema={schema} items={visible} chosen={chosen} onToggle={toggle} />
        )}
        <div className="flex items-center justify-between gap-2 border-t px-1 pt-2 text-xs">
          <span className="text-muted-foreground tabular-nums">
            {count === null ? "–" : `${count.toLocaleString("de-DE")} ausgewählt`}
          </span>
          <span className="flex items-center gap-3">
            {needle && visible.length > 0 && (
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => commit(new Set([...chosen, ...matches.map((item) => item.key)]))}
              >
                Treffer wählen
              </button>
            )}
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => {
                onChange(null);
                onObjects(null);
              }}
            >
              Alle
            </button>
            <button
              type="button"
              className="text-primary hover:underline"
              disabled={!loaded.data}
              onClick={() => commit(new Set())}
            >
              Keine
            </button>
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
