import { DatabaseIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROW_COUNT_FIELD, type ShelfId, type WorksheetField } from "@/lib/chart-worksheet";
import { queryErrorMessage } from "@/lib/connection-url";
import { type Dataset, isNumericType } from "@/lib/dashboards";
import { useTablesQuery, useViewsQuery } from "@/lib/queries";
import { useRelations } from "./use-dataset-query";
import { WorksheetFieldItem } from "./worksheet-field";

export function WorksheetFields({
  dataset,
  chartId,
  fields,
  loading,
  error,
  onRetry,
  onSource,
  onJoin,
  onPlace,
  targets,
}: {
  dataset: Dataset;
  chartId: string;
  fields: WorksheetField[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onSource: (schema: string, table: string) => void;
  onJoin: (join: Dataset["simple"]["join"]) => void;
  onPlace: (field: WorksheetField, shelf?: ShelfId) => void;
  targets: { id: ShelfId; label: string }[];
}) {
  const [search, setSearch] = useState("");
  const tables = useTablesQuery();
  const views = useViewsQuery();
  const relations = useRelations(dataset.simple.schema, dataset.simple.table);
  const key = (schema: string, table: string) => JSON.stringify([schema, table]);
  const selected = dataset.simple.table ? key(dataset.simple.schema, dataset.simple.table) : "";
  const sources = [...(tables.data ?? []), ...(views.data ?? [])];
  const selectedMissing = selected && !sources.some((s) => key(s.schema, s.name) === selected);
  const joinValue =
    relations.find((r) => JSON.stringify(r.join) === JSON.stringify(dataset.simple.join))?.key ??
    "none";
  const visible = fields.filter((f) => f.label.toLowerCase().includes(search.toLowerCase()));
  return (
    <aside aria-label="Datenfelder" className="flex min-h-0 min-w-0 flex-col border-r bg-card">
      <div className="space-y-3 border-b p-4">
        <div className="flex items-center gap-2">
          <DatabaseIcon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Daten</h2>
        </div>
        <Select
          value={selected}
          onValueChange={(value) => {
            const [schema, table] = JSON.parse(value) as string[];
            onSource(schema, table);
          }}
        >
          <SelectTrigger aria-label="Datenquelle" className="h-8 w-full text-xs">
            <SelectValue placeholder="Tabelle oder View wählen" />
          </SelectTrigger>
          <SelectContent searchable>
            {selectedMissing && (
              <SelectItem value={selected}>
                {dataset.simple.schema}.{dataset.simple.table}
              </SelectItem>
            )}
            <SelectGroup>
              <SelectLabel>Views</SelectLabel>
              {(views.data ?? []).map((s) => (
                <SelectItem key={key(s.schema, s.name)} value={key(s.schema, s.name)}>
                  {s.name}
                  <span className="ml-2 text-muted-foreground">{s.schema}</span>
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Tabellen</SelectLabel>
              {(tables.data ?? []).map((s) => (
                <SelectItem key={key(s.schema, s.name)} value={key(s.schema, s.name)}>
                  {s.name}
                  <span className="ml-2 text-muted-foreground">{s.schema}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {(tables.error || views.error) && (
          <p role="alert" className="text-xs text-destructive">
            {queryErrorMessage(tables.error || views.error)}
          </p>
        )}
        {relations.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Verknüpfte Tabelle{" "}
              {dataset.simple.join ? `· ${dataset.simple.join.table}` : "hinzufügen"}
            </summary>
            <Select
              value={joinValue}
              onValueChange={(value) =>
                onJoin(relations.find((r) => r.key === value)?.join ?? null)
              }
            >
              <SelectTrigger aria-label="Verknüpfte Tabelle" className="mt-2 h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent searchable>
                <SelectItem value="none">Ohne Verknüpfung</SelectItem>
                {relations.map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </details>
        )}
        <div className="relative">
          <SearchIcon className="absolute top-2 left-2 size-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Felder suchen"
            placeholder="Felder suchen"
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {loading && (
          <p role="status" className="p-2 text-xs text-muted-foreground">
            Felder werden geladen…
          </p>
        )}
        {error ? (
          <div role="alert" className="space-y-2 p-2 text-xs text-destructive">
            <p>{queryErrorMessage(error)}</p>
            <Button size="xs" variant="outline" onClick={onRetry}>
              Erneut laden
            </Button>
          </div>
        ) : !dataset.simple.table ? (
          <p className="p-2 text-xs leading-relaxed text-muted-foreground">
            Wähle eine Tabelle oder View. Ihre Felder erscheinen hier.
          </p>
        ) : null}
        {([false, true] as const).map((numeric) => (
          <section key={String(numeric)} className="mb-4">
            <h3 className="mb-1 px-2 text-[11px] font-semibold text-muted-foreground">
              {numeric ? "Zahlen & Kennzahlen" : "Kategorien & Datum"}
            </h3>
            {visible
              .filter((f) => (isNumericType(f.dataType) || f.ref === ROW_COUNT_FIELD) === numeric)
              .map((field) => (
                <WorksheetFieldItem
                  key={field.ref}
                  field={field}
                  chartId={chartId}
                  onPlace={onPlace}
                  targets={targets}
                />
              ))}
          </section>
        ))}
        {dataset.simple.table && !loading && !visible.length && (
          <p className="p-2 text-xs text-muted-foreground">Keine passenden Felder.</p>
        )}
      </div>
      <p className="border-t p-4 text-[11px] leading-relaxed text-muted-foreground">
        Felder auf eine Ablage ziehen. Alternativ ein Feld anklicken und sein Ziel wählen oder
        doppelklicken.
      </p>
    </aside>
  );
}
