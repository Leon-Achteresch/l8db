import { ChevronDownIcon, PlusIcon, WandSparklesIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterOperatorSelect } from "@/features/filters/filter-operator-select";
import { FilterValueInput } from "@/features/filters/filter-value-input";
import { useActiveConnection } from "@/lib/connections";
import {
  AGG_LABEL,
  type Agg,
  BUCKET_LABEL,
  createId,
  type Dataset,
  type DatasetMetric,
  emptySimple,
  isDateType,
  isNumericType,
  joinRef,
  type SimpleDataset,
  type SortMode,
  type TimeBucket,
} from "@/lib/dashboards";
import { supports } from "@/lib/providers";
import { useDetailedColumnsQuery } from "@/lib/queries";
import { operatorNeedsValue } from "@/lib/sql-filter";
import { ColumnSelect } from "./dataset-column-select";
import { DatasetSourcePicker } from "./dataset-source-picker";
import { Step } from "./dataset-step";
import { useRelations } from "./use-dataset-query";

interface ColumnOpt {
  ref: string;
  label: string;
  type: string;
}

const NONE = "__none__";

export function SimpleBuilder({
  dataset,
  onChange,
}: {
  dataset: Dataset;
  onChange: (patch: Partial<SimpleDataset>) => void;
}) {
  const s = dataset.simple;
  const [step, setStep] = useState(1);
  const connection = useActiveConnection();
  const baseColumns = useDetailedColumnsQuery(s.schema, s.table);
  const relations = useRelations(s.schema, s.table);
  const joinColumns = useDetailedColumnsQuery(s.join?.schema ?? "", s.join?.table ?? "");
  const hasFks = supports(connection, "foreign_keys");

  const columns = useMemo<ColumnOpt[]>(() => {
    const base = (baseColumns.data ?? []).map((c) => ({
      ref: c.name,
      label: c.name,
      type: c.data_type,
    }));
    const joined = s.join
      ? (joinColumns.data ?? []).map((c) => ({
          ref: joinRef(c.name),
          label: `${s.join?.table}.${c.name}`,
          type: c.data_type,
        }))
      : [];
    return [...base, ...joined];
  }, [baseColumns.data, joinColumns.data, s.join]);

  const typeOf = (ref: string | null) => columns.find((c) => c.ref === ref)?.type ?? "";
  const joinValue =
    relations.find(
      (r) =>
        s.join &&
        r.join.table === s.join.table &&
        r.join.fromColumn === s.join.fromColumn &&
        r.join.toColumn === s.join.toColumn,
    )?.key ?? NONE;
  const baseKey =
    (baseColumns.data ?? []).find((c) => c.is_primary_key)?.name ?? baseColumns.data?.[0]?.name;
  const dateColumns = columns.filter((c) => isDateType(c.type));
  const suggestion = dateColumns[0] ?? null;

  const updateMetric = (id: string, patch: Partial<DatasetMetric>) =>
    onChange({ metrics: s.metrics.map((m) => (m.id === id ? { ...m, ...patch } : m)) });

  return (
    <div className="space-y-4">
      <nav aria-label="Datensatz vorbereiten" className="flex flex-wrap gap-2">
        {["Quelle wählen", "Kennzahlen sammeln", "Gruppieren", "Filtern", "Ergebnis begrenzen"].map(
          (label, index) => (
            <Button
              key={label}
              size="sm"
              variant={step === index + 1 ? "secondary" : "ghost"}
              aria-current={step === index + 1 ? "step" : undefined}
              onClick={() => setStep(index + 1)}
            >
              {index + 1}. {label}
            </Button>
          ),
        )}
      </nav>
      <Step
        active={step === 1}
        n={1}
        title="Woher kommen die Daten?"
        hint="Wähle eine Tabelle oder View, die deine Daten enthält. Bei Tabellen kannst du eine verknüpfte Tabelle einbeziehen: übergeordnete (z. B. Kunde zum Auftrag) oder untergeordnete (z. B. Positionen zum Auftrag)."
        done={Boolean(s.table)}
      >
        <DatasetSourcePicker
          schema={s.schema}
          table={s.table}
          onChange={(schema, table) => onChange({ ...emptySimple(), schema, table })}
        />
        {hasFks && s.table && relations.length > 0 && (
          <Select
            value={joinValue}
            onValueChange={(v) => {
              onChange({ join: relations.find((r) => r.key === v)?.join ?? null });
            }}
          >
            <SelectTrigger size="sm" className="h-8 w-full text-xs">
              <SelectValue placeholder="Verknüpfte Tabelle" />
            </SelectTrigger>
            <SelectContent searchable>
              <SelectItem value={NONE}>Keine verknüpfte Tabelle</SelectItem>
              {relations.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Step>

      <Step
        active={step === 2}
        n={2}
        title="Was möchtest du messen?"
        hint="Eine Kennzahl ist eine Zahl pro Gruppe, z. B. „Anzahl Bestellungen“ oder „Summe Umsatz“. Für „Anzahl Zeilen“ brauchst du keine Spalte."
        done={Boolean(s.table) && s.metrics.some((m) => m.agg === "count" || m.column)}
      >
        {s.metrics.map((m) => (
          <div key={m.id} className="space-y-1.5 rounded-lg border bg-background/60 p-2">
            <div className="flex gap-1.5">
              <Select
                value={m.agg}
                onValueChange={(agg) => updateMetric(m.id, { agg: agg as Agg })}
              >
                <SelectTrigger size="sm" className="h-8 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(AGG_LABEL) as Agg[]).map((agg) => (
                    <SelectItem key={agg} value={agg}>
                      {AGG_LABEL[agg]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {s.metrics.length > 1 && (
                <IconButton
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Kennzahl entfernen"
                  onClick={() => onChange({ metrics: s.metrics.filter((x) => x.id !== m.id) })}
                >
                  <XIcon />
                </IconButton>
              )}
            </div>
            {m.agg !== "count" && (
              <ColumnSelect
                value={m.column}
                onChange={(column) => updateMetric(m.id, { column })}
                columns={columns}
                placeholder={
                  m.agg === "count_distinct" || m.agg === "none" ? "Spalte" : "Zahlenspalte"
                }
                filter={
                  m.agg === "sum" || m.agg === "avg" ? (c) => isNumericType(c.type) : undefined
                }
              />
            )}
            <Input
              className="h-7 text-xs"
              placeholder="Bezeichnung im Chart (optional)"
              value={m.label}
              onChange={(e) => updateMetric(m.id, { label: e.target.value })}
            />
          </div>
        ))}
        {s.metrics.length < 4 && (
          <Button
            variant="outline"
            size="xs"
            onClick={() =>
              onChange({
                metrics: [...s.metrics, { id: createId(), agg: "sum", column: null, label: "" }],
              })
            }
          >
            <PlusIcon /> Weitere Kennzahl
          </Button>
        )}
        {s.join && baseKey && (
          <Button
            variant="secondary"
            size="xs"
            onClick={() =>
              onChange({
                metrics: [
                  {
                    id: createId(),
                    agg: "count",
                    column: joinRef(s.join?.toColumn ?? ""),
                    label: `Anzahl ${s.join?.table}`,
                  },
                ],
                dimension: { column: baseKey, bucket: "none" },
                sort: "metric_desc",
              })
            }
          >
            <WandSparklesIcon /> Vorschlag: Anzahl {s.join.table} je {s.table}
          </Button>
        )}
      </Step>

      <Step
        active={step === 3}
        n={3}
        title="Wonach aufteilen?"
        hint="Jeder Wert dieser Spalte wird ein Punkt, Balken oder Segment im Chart. Bei Datumsspalten kannst du nach Tag, Monat oder Jahr zusammenfassen."
        done={Boolean(s.dimension)}
        optional
      >
        <ColumnSelect
          value={s.dimension?.column ?? null}
          onChange={(column) =>
            onChange({
              dimension: column
                ? { column, bucket: isDateType(typeOf(column)) ? "month" : "none" }
                : null,
            })
          }
          columns={columns}
          allowNone="Nicht aufteilen (nur Gesamtwert)"
        />
        {s.dimension && isDateType(typeOf(s.dimension.column)) && (
          <Select
            value={s.dimension.bucket}
            onValueChange={(bucket) =>
              onChange({
                dimension: { column: s.dimension?.column ?? "", bucket: bucket as TimeBucket },
              })
            }
          >
            <SelectTrigger size="sm" className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(BUCKET_LABEL) as TimeBucket[]).map((b) => (
                <SelectItem key={b} value={b}>
                  {BUCKET_LABEL[b]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {!s.dimension && suggestion && (
          <Button
            variant="secondary"
            size="xs"
            onClick={() =>
              onChange({
                dimension: { column: suggestion.ref, bucket: "month" },
                dateColumn: s.dateColumn ?? suggestion.ref,
              })
            }
          >
            <WandSparklesIcon /> Vorschlag: {suggestion.label} pro Monat
          </Button>
        )}
        <details className="group">
          <summary className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
            <ChevronDownIcon className="size-3 transition-transform group-open:rotate-180" />
            Zweite Aufteilung (für Fluss-Diagramm)
          </summary>
          <div className="mt-1.5">
            <ColumnSelect
              value={s.dimension2}
              onChange={(dimension2) => onChange({ dimension2 })}
              columns={columns}
              allowNone="Keine zweite Aufteilung"
            />
          </div>
        </details>
      </Step>

      <Step
        active={step === 4}
        n={4}
        title="Eingrenzen"
        hint="Lass nur Zeilen zu, die bestimmte Bedingungen erfüllen. Mit einer Zeitspalte kannst du im Chart später zwischen „Letzte 7 Tage“, „Dieses Jahr“ usw. wechseln."
        done={s.filters.length > 0 || Boolean(s.dateColumn)}
        optional
      >
        {s.filters.map((f) => (
          <div
            key={f.id}
            className="grid grid-cols-[1fr_auto] gap-1.5 rounded-lg border bg-background/60 p-2"
          >
            <ColumnSelect
              value={f.column || null}
              onChange={(column) =>
                onChange({
                  filters: s.filters.map((x) =>
                    x.id === f.id
                      ? {
                          ...x,
                          column: column ?? "",
                          dataType: columns.find((entry) => entry.ref === column)?.type,
                        }
                      : x,
                  ),
                })
              }
              columns={columns}
            />
            <IconButton
              variant="ghost"
              size="icon-sm"
              aria-label="Filter entfernen"
              onClick={() => onChange({ filters: s.filters.filter((x) => x.id !== f.id) })}
            >
              <XIcon />
            </IconButton>
            <div className="col-span-2 flex gap-1.5">
              <FilterOperatorSelect
                operator={f.operator}
                value={f.value}
                onChange={(operator, value) =>
                  onChange({
                    filters: s.filters.map((x) => (x.id === f.id ? { ...x, operator, value } : x)),
                  })
                }
                className="h-8 flex-1 text-xs"
                size="sm"
              />
              {operatorNeedsValue(f.operator) && (
                <FilterValueInput
                  key={f.operator}
                  operator={f.operator}
                  className="h-8 flex-1 text-xs"
                  placeholder="Wert"
                  value={f.value}
                  onValueChange={(value) =>
                    onChange({
                      filters: s.filters.map((x) => (x.id === f.id ? { ...x, value } : x)),
                    })
                  }
                />
              )}
            </div>
          </div>
        ))}
        <Button
          variant="outline"
          size="xs"
          onClick={() =>
            onChange({
              filters: [...s.filters, { id: createId(), column: "", operator: "eq", value: "" }],
            })
          }
        >
          <PlusIcon /> Bedingung
        </Button>
        <div>
          <p className="mb-1 text-[11px] text-muted-foreground">Zeitspalte für Zeitraum-Filter</p>
          <ColumnSelect
            value={s.dateColumn}
            onChange={(dateColumn) => onChange({ dateColumn })}
            columns={columns}
            filter={(c) => isDateType(c.type)}
            allowNone="Keine Zeitspalte"
          />
        </div>
      </Step>

      <Step
        active={step === 5}
        n={5}
        title="Sortierung und Anzahl"
        hint="Für Verläufe sortierst du nach der Aufteilung, für Top-Listen nach der Kennzahl. Die Anzahl begrenzt, wie viele Gruppen im Chart landen."
        done={Boolean(s.table)}
        optional
      >
        <div className="flex gap-1.5">
          <Select value={s.sort} onValueChange={(sort) => onChange({ sort: sort as SortMode })}>
            <SelectTrigger size="sm" className="h-8 flex-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dimension">Nach Aufteilung (A→Z, alt→neu)</SelectItem>
              <SelectItem value="metric_desc">Größte Kennzahl zuerst</SelectItem>
              <SelectItem value="metric_asc">Kleinste Kennzahl zuerst</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={1}
            max={5000}
            className="h-8 w-20 text-xs"
            aria-label="Maximale Anzahl"
            value={s.limit}
            onChange={(e) => onChange({ limit: Number(e.target.value) || 50 })}
          />
        </div>
      </Step>
      <div className="flex items-center justify-between border-t pt-4">
        <Button variant="ghost" size="sm" disabled={step === 1} onClick={() => setStep(step - 1)}>
          ← Zurück
        </Button>
        <span className="text-xs text-muted-foreground">{step} von 5</span>
        <Button size="sm" disabled={step === 5 || !s.table} onClick={() => setStep(step + 1)}>
          Weiter →
        </Button>
      </div>
    </div>
  );
}
