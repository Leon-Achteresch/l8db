import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, FilterIcon } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { listTables } from "@/lib/db";
import { prepareConnection } from "@/lib/prepare-connection";
import { effectiveConnectionString } from "@/lib/ssh";
import { cn } from "@/lib/utils";
import { TransferTableList } from "./transfer-table-list";

export function TransferTablePicker({
  connectionId,
  database,
  schema,
  total,
  selected,
  onChange,
}: {
  connectionId: string;
  database: string | null;
  schema: string;
  total: number | null;
  selected: string[] | undefined;
  onChange: (value: string[] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const tables = useQuery({
    queryKey: ["transfer-tables", connectionId, database, schema],
    enabled: open,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const ready = await prepareConnection(connectionId);
      const result = await listTables(
        ready.kind,
        effectiveConnectionString(ready),
        database ?? undefined,
        schema,
      );
      return result.map((table) => table.name).sort((a, b) => a.localeCompare(b));
    },
  });
  const names = tables.data ?? [];
  const needle = query.trim().toLowerCase();
  const visible = needle ? names.filter((name) => name.toLowerCase().includes(needle)) : names;
  const chosen = new Set(selected ?? names);
  const count = tables.data ? names.filter((name) => chosen.has(name)).length : null;
  const known = tables.data ? names.length : total;
  const commit = (next: Set<string>) =>
    onChange(names.every((name) => next.has(name)) ? null : names.filter((name) => next.has(name)));
  const toggle = (name: string) => {
    const next = new Set(chosen);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    commit(next);
  };
  const label = selected
    ? `${(count ?? selected.length).toLocaleString("de-DE")} von ${known?.toLocaleString("de-DE") ?? "?"}`
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
          selected && "border-primary/40 bg-primary/5 text-primary",
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
            placeholder="Tabellen filtern"
            aria-label="Tabellen filtern"
            className="h-8 pl-8 text-xs md:text-xs"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {tables.isPending ? (
          <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            Tabellen werden geladen…
          </p>
        ) : tables.isError ? (
          <p role="alert" className="px-2 py-4 text-xs text-destructive">
            {tables.error instanceof Error ? tables.error.message : String(tables.error)}
          </p>
        ) : visible.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            {names.length === 0 ? "Keine Tabellen." : "Keine Treffer."}
          </p>
        ) : (
          <TransferTableList schema={schema} names={visible} chosen={chosen} onToggle={toggle} />
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
                onClick={() => commit(new Set([...chosen, ...visible]))}
              >
                Treffer wählen
              </button>
            )}
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => onChange(null)}
            >
              Alle
            </button>
            <button
              type="button"
              className="text-primary hover:underline"
              disabled={!tables.data}
              onClick={() => onChange([])}
            >
              Keine
            </button>
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
