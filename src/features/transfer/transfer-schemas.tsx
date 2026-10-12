import { ArrowRightIcon, ChevronRightIcon, FilterIcon, LayersIcon, TableIcon } from "lucide-react";
import { Fragment, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBytes } from "@/lib/backup";
import type { SchemaSize, TransferPlan } from "@/lib/db";
import { cn } from "@/lib/utils";

export function TransferSchemas({
  schemas,
  existing,
  selected,
  mapping,
  plan,
  sizes,
  onToggle,
  onSelectAll,
  onMap,
}: {
  schemas: string[];
  existing: string[];
  selected: string[];
  mapping: Record<string, string>;
  plan: TransferPlan | null;
  sizes: Record<string, SchemaSize>;
  onToggle: (schema: string) => void;
  onSelectAll: (value: string[]) => void;
  onMap: (schema: string, target: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<"all" | "selected">("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const needle = query.trim().toLowerCase();
  const visible = schemas.filter(
    (schema) =>
      (only === "all" || selected.includes(schema)) &&
      (!needle || schema.toLowerCase().includes(needle)),
  );
  const conflicts = new Set(plan?.conflicts ?? []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
      <datalist id="transfer-target-schemas">
        {existing.map((schema) => (
          <option key={schema} value={schema} />
        ))}
      </datalist>
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <div className="relative w-64 min-w-0">
          <FilterIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            placeholder="Schemas filtern"
            aria-label="Schemas filtern"
            className="h-8 pl-8 text-xs md:text-xs"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Tabs value={only} onValueChange={(value) => setOnly(value as "all" | "selected")}>
          <TabsList aria-label="Anzeige" className="group-data-horizontal/tabs:h-8">
            <TabsTrigger value="all" className="flex-none px-2.5 text-xs">
              Alle
            </TabsTrigger>
            <TabsTrigger value="selected" className="flex-none px-2.5 text-xs">
              Ausgewählt
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed border-collapse text-[13px]">
          <colgroup>
            <col className="w-10" />
            <col />
            <col className="w-44" />
            <col className="w-22" />
            <col className="w-22" />
            <col className="w-36" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 pl-3" aria-label="Auswahl" />
              <th className="py-2 text-left font-medium">Objekt</th>
              <th className="py-2 pr-3 text-left font-medium">Ziel</th>
              <th className="py-2 pr-4 text-right font-medium">Tabellen</th>
              <th className="py-2 pr-4 text-right font-medium">Größe</th>
              <th className="py-2 pr-3 text-left font-medium">Im Ziel</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((schema) => {
              const checked = selected.includes(schema);
              const target = (mapping[schema] ?? "").trim() || schema;
              const tables = checked
                ? (plan?.tables ?? []).filter((table) => table.sourceSchema === schema)
                : [];
              const expanded = Boolean(open[schema]) && tables.length > 0;
              const blocked = tables.filter((table) =>
                conflicts.has(`${table.targetSchema}.${table.targetName}`),
              ).length;
              const isNew = plan
                ? plan.createSchemas.includes(target)
                : existing.length > 0 && !existing.includes(target);
              const size = sizes[schema];
              return (
                <Fragment key={schema}>
                  <tr
                    className={cn(
                      "border-b transition-colors hover:bg-muted/40",
                      !checked && "text-muted-foreground",
                    )}
                  >
                    <td className="py-1.5 pl-3">
                      <Checkbox
                        id={`transfer-schema-${schema}`}
                        checked={checked}
                        onCheckedChange={() => onToggle(schema)}
                      />
                    </td>
                    <td className="py-1.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <button
                          type="button"
                          aria-label={expanded ? "Zuklappen" : "Aufklappen"}
                          aria-expanded={expanded}
                          disabled={tables.length === 0}
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                          onClick={() =>
                            setOpen((current) => ({ ...current, [schema]: !current[schema] }))
                          }
                        >
                          <ChevronRightIcon
                            className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
                          />
                        </button>
                        <LayersIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <label
                          htmlFor={`transfer-schema-${schema}`}
                          className="min-w-0 cursor-pointer truncate font-mono font-medium"
                        >
                          {schema}
                        </label>
                      </div>
                    </td>
                    <td className="py-1 pr-3">
                      {checked && (
                        <div className="flex min-w-0 items-center gap-1.5">
                          <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          <Input
                            className="h-7 min-w-0 flex-1 font-mono text-xs md:text-xs"
                            list="transfer-target-schemas"
                            aria-label={`Zielschema für ${schema}`}
                            placeholder={schema}
                            value={mapping[schema] ?? ""}
                            onChange={(event) => onMap(schema, event.target.value)}
                          />
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {checked && plan ? (
                        <>
                          {tables.length.toLocaleString("de-DE")}
                          {size && (
                            <span className="text-muted-foreground">
                              {" "}
                              / {size.table_count.toLocaleString("de-DE")}
                            </span>
                          )}
                        </>
                      ) : size ? (
                        size.table_count.toLocaleString("de-DE")
                      ) : (
                        "–"
                      )}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {size ? formatBytes(size.size_bytes) : "–"}
                    </td>
                    <td className="py-1.5 pr-3 text-xs">
                      {!checked ? (
                        "–"
                      ) : blocked > 0 ? (
                        <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-400">
                          {blocked} vorhanden
                        </span>
                      ) : isNew ? (
                        "Schema neu anlegen"
                      ) : (
                        "Schema vorhanden"
                      )}
                    </td>
                  </tr>
                  {expanded &&
                    tables.map((table) => {
                      const exists = conflicts.has(`${table.targetSchema}.${table.targetName}`);
                      return (
                        <tr
                          key={`${schema}.${table.sourceName}`}
                          className="border-b hover:bg-muted/40"
                        >
                          <td />
                          <td className="py-1.5 pl-10">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <TableIcon className="size-3.5 shrink-0 text-muted-foreground" />
                              <span className="truncate font-mono">{table.sourceName}</span>
                            </span>
                          </td>
                          <td className="truncate py-1.5 pr-3 font-mono text-xs text-muted-foreground">
                            <span className="pl-5">
                              {table.targetSchema}.{table.targetName}
                            </span>
                          </td>
                          <td className="py-1.5 pr-4 text-right text-xs text-muted-foreground tabular-nums">
                            {table.columns.length} Sp.
                          </td>
                          <td />
                          <td className="py-1.5 pr-3 text-xs">
                            {exists ? (
                              <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-400">
                                Vorhanden, blockiert
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Neu anlegen</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {schemas.length === 0 ? "Keine Schemas gefunden." : "Keine Treffer."}
          </p>
        )}
      </div>
      <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-t px-4 text-xs">
        <span className="text-muted-foreground tabular-nums">
          {selected.length} von {schemas.length} Schemas
        </span>
        <span className="flex items-center gap-3">
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => onSelectAll(schemas)}
          >
            Alle
          </button>
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => onSelectAll([])}
          >
            Keine
          </button>
        </span>
      </div>
    </div>
  );
}
