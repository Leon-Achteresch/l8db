import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
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
import {
  AGG_LABEL,
  type Agg,
  BUCKET_LABEL,
  createId,
  type Dataset,
  isDateType,
  isNumericType,
  type SimpleDataset,
  type SortMode,
  syncJoins,
  type TimeBucket,
} from "@/lib/dashboards";
import { filterOperatorLabel, parseFilterList } from "@/lib/sql-filter";
import { ChartFilterEditor, type ChartFilterField } from "./chart-filter-editor";
import { ColumnSelect } from "./dataset-column-select";
import { useDatasetColumns } from "./use-dataset-query";

const AGG_SIMPLE: Record<Agg, string> = {
  count: "Anzahl Zeilen",
  count_distinct: "Anzahl verschiedener Werte",
  sum: "Summe",
  avg: "Durchschnitt",
  min: "Kleinster Wert",
  max: "Größter Wert",
  none: "Jeden Wert einzeln",
};

export function ChartQuestionStep({
  dataset,
  onChange,
  resultColumns,
}: {
  dataset: Dataset;
  onChange: (patch: Partial<Dataset>) => void;
  resultColumns: string[];
}) {
  const s = dataset.simple;
  const { columns, joins } = useDatasetColumns(s);
  const [filterDraft, setFilterDraft] = useState<{
    field: ChartFilterField;
    filterId?: string;
  } | null>(null);

  const typeOf = (ref: string | null | undefined) => columns.find((c) => c.ref === ref)?.type ?? "";
  const fieldOf = (ref: string): ChartFilterField => ({
    ref,
    label: columns.find((c) => c.ref === ref)?.label ?? ref,
    dataType: typeOf(ref),
  });

  if (dataset.mode === "expert") {
    const m = dataset.mapping;
    const opts = resultColumns.map((c) => ({ ref: c, label: c, type: "" }));
    const setMapping = (patch: Partial<typeof m>) => onChange({ mapping: { ...m, ...patch } });
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-sm font-semibold">Ordne die Spalten deiner Abfrage zu</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {resultColumns.length
              ? "Deine Abfrage liefert diese Spalten. Sage dem Chart, was was ist."
              : "Sobald deine Abfrage rechts ein Ergebnis zeigt, kannst du hier die Spalten zuordnen."}
          </p>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium">Wonach wird aufgeteilt? (z. B. Monat oder Land)</p>
          <ColumnSelect
            value={m.dimension}
            onChange={(dimension) => setMapping({ dimension })}
            columns={opts}
            allowNone="Keine Aufteilung"
          />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium">Welche Spalten sind die Zahlen?</p>
          <div className="flex flex-wrap gap-1.5">
            {opts.map((c) => {
              const active = m.metrics.includes(c.ref);
              return (
                <Button
                  key={c.ref}
                  type="button"
                  size="xs"
                  variant={active ? "secondary" : "outline"}
                  aria-pressed={active}
                  onClick={() =>
                    setMapping({
                      metrics: active
                        ? m.metrics.filter((k) => k !== c.ref)
                        : [...m.metrics, c.ref],
                    })
                  }
                >
                  {c.label}
                </Button>
              );
            })}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium">Zweite Aufteilung (für Fluss- und Matrix-Charts)</p>
          <ColumnSelect
            value={m.dimension2}
            onChange={(dimension2) => setMapping({ dimension2 })}
            columns={opts}
            allowNone="Keine"
          />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium">Zeitspalte (für die Zeitraum-Auswahl im Chart)</p>
          <ColumnSelect
            value={m.dateColumn}
            onChange={(dateColumn) => setMapping({ dateColumn })}
            columns={opts}
            allowNone="Keine"
          />
        </div>
      </div>
    );
  }

  const patchSimple = (patch: Partial<SimpleDataset>) =>
    onChange({ simple: syncJoins({ ...s, ...patch }, joins) });

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">1 · Was möchtest du messen?</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Zum Beispiel „Anzahl Zeilen“ für die Menge oder „Summe von Betrag“ für Geld.
          </p>
        </div>
        {s.metrics.map((metric) => {
          const colType = typeOf(metric.column);
          const allowed = (Object.keys(AGG_LABEL) as Agg[]).filter((agg) =>
            !metric.column
              ? agg === "count"
              : isNumericType(colType)
                ? true
                : !["sum", "avg"].includes(agg),
          );
          return (
            <div
              key={metric.id}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border bg-card/60 p-3"
            >
              <Select
                value={metric.agg}
                onValueChange={(agg) =>
                  patchSimple({
                    metrics: s.metrics.map((x) =>
                      x.id === metric.id
                        ? { ...x, agg: agg as Agg, column: agg === "count" ? null : x.column }
                        : x,
                    ),
                  })
                }
              >
                <SelectTrigger size="sm" className="h-8 text-xs" aria-label="Berechnung">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allowed.map((agg) => (
                    <SelectItem key={agg} value={agg}>
                      {AGG_SIMPLE[agg]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {metric.agg === "count" ? (
                <span className="px-1 text-xs text-muted-foreground">von allen Zeilen</span>
              ) : (
                <ColumnSelect
                  value={metric.column}
                  onChange={(column) =>
                    patchSimple({
                      metrics: s.metrics.map((x) => (x.id === metric.id ? { ...x, column } : x)),
                    })
                  }
                  columns={columns}
                  placeholder="Spalte wählen"
                  filter={
                    metric.agg === "sum" || metric.agg === "avg"
                      ? (c) => isNumericType(c.type)
                      : undefined
                  }
                />
              )}
              <IconButton
                variant="ghost"
                size="icon-sm"
                aria-label="Kennzahl entfernen"
                disabled={s.metrics.length === 1}
                onClick={() =>
                  patchSimple({ metrics: s.metrics.filter((x) => x.id !== metric.id) })
                }
              >
                <XIcon />
              </IconButton>
              <Input
                className="col-span-3 h-7 text-xs"
                placeholder="Eigener Name im Chart (optional)"
                value={metric.label}
                onChange={(e) =>
                  patchSimple({
                    metrics: s.metrics.map((x) =>
                      x.id === metric.id ? { ...x, label: e.target.value } : x,
                    ),
                  })
                }
              />
            </div>
          );
        })}
        {s.metrics.length < 4 && (
          <Button
            variant="outline"
            size="xs"
            onClick={() =>
              patchSimple({
                metrics: [...s.metrics, { id: createId(), agg: "sum", column: null, label: "" }],
              })
            }
          >
            <PlusIcon /> Weitere Kennzahl
          </Button>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">2 · Wie willst du aufteilen?</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Jeder Wert dieser Spalte wird ein Balken, Punkt oder Stück im Chart — zum Beispiel jedes
            Land oder jeder Monat.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <ColumnSelect
            value={s.dimension?.column ?? null}
            onChange={(column) =>
              patchSimple({
                dimension: column
                  ? { column, bucket: isDateType(typeOf(column)) ? "month" : "none" }
                  : null,
                ...(column && isDateType(typeOf(column)) && !s.dateColumn
                  ? { dateColumn: column }
                  : {}),
              })
            }
            columns={columns}
            allowNone="Nicht aufteilen (nur Gesamtwert)"
            placeholder="Aufteilen nach …"
          />
          {s.dimension && isDateType(typeOf(s.dimension.column)) && (
            <Select
              value={s.dimension.bucket}
              onValueChange={(bucket) =>
                patchSimple({
                  dimension: { column: s.dimension?.column ?? "", bucket: bucket as TimeBucket },
                })
              }
            >
              <SelectTrigger size="sm" className="h-8 text-xs" aria-label="Datum zusammenfassen">
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
        </div>
        <details className="rounded-xl border bg-card/60 p-3">
          <summary className="cursor-pointer text-xs font-medium">
            Noch feiner aufteilen? (zweite Kategorie)
          </summary>
          <div className="mt-2">
            <ColumnSelect
              value={s.dimension2}
              onChange={(dimension2) => patchSimple({ dimension2 })}
              columns={columns.filter((c) => c.ref !== s.dimension?.column)}
              allowNone="Keine zweite Aufteilung"
            />
          </div>
        </details>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">3 · Nur bestimmte Daten zeigen?</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Zum Beispiel nur Bestellungen aus Deutschland oder über 100 €. Ohne Filter wird alles
            gezeigt.
          </p>
        </div>
        {s.filters.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {s.filters.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilterDraft({ field: fieldOf(f.column), filterId: f.id })}
                className="flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-[11px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="font-medium">{fieldOf(f.column).label}</span>
                <span className="text-muted-foreground">
                  {filterOperatorLabel(f.operator, true)}{" "}
                  {["in", "notIn"].includes(f.operator)
                    ? parseFilterList(f.value).join(", ")
                    : f.value}
                </span>
                <XIcon
                  className="size-3 text-muted-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    patchSimple({
                      filters: s.filters.filter(
                        (x) => x.id !== f.id && (!f.rangeId || x.rangeId !== f.rangeId),
                      ),
                    });
                  }}
                />
              </button>
            ))}
          </div>
        )}
        <div className="max-w-72">
          <ColumnSelect
            value={null}
            onChange={(ref) => {
              if (ref) setFilterDraft({ field: fieldOf(ref) });
            }}
            columns={columns}
            placeholder="+ Filter hinzufügen"
          />
        </div>
        {filterDraft && (
          <ChartFilterEditor
            key={filterDraft.filterId ?? filterDraft.field.ref}
            field={filterDraft.field}
            simple={syncJoins(s, joins, [filterDraft.field.ref])}
            filter={s.filters.find((f) => f.id === filterDraft.filterId)}
            onCancel={() => setFilterDraft(null)}
            onApply={(filters) => {
              const old = s.filters.find((f) => f.id === filterDraft.filterId);
              patchSimple({
                filters: [
                  ...s.filters.filter((f) =>
                    old ? f.id !== old.id && (!old.rangeId || f.rangeId !== old.rangeId) : true,
                  ),
                  ...filters,
                ],
              });
              setFilterDraft(null);
            }}
          />
        )}
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Zeitspalte für die Zeitraum-Auswahl</p>
          <p className="text-[11px] text-muted-foreground">
            Mit einer Zeitspalte kannst du im Chart später „Letzte 30 Tage“ u. ä. wählen.
          </p>
          <div className="max-w-72">
            <ColumnSelect
              value={s.dateColumn}
              onChange={(dateColumn) => patchSimple({ dateColumn })}
              columns={columns}
              filter={(c) => isDateType(c.type)}
              allowNone="Keine Zeitspalte"
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">4 · Reihenfolge und Höchstzahl</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={s.sort} onValueChange={(sort) => patchSimple({ sort: sort as SortMode })}>
            <SelectTrigger size="sm" className="h-8 text-xs" aria-label="Sortierung">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dimension">Aufteilung A→Z / alt→neu</SelectItem>
              <SelectItem value="metric_desc">Größte Werte zuerst</SelectItem>
              <SelectItem value="metric_asc">Kleinste Werte zuerst</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={String(s.limit)}
            onValueChange={(limit) => patchSimple({ limit: Number(limit) })}
          >
            <SelectTrigger size="sm" className="h-8 text-xs" aria-label="Höchstzahl an Gruppen">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 25, 50, 100, 500].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  Höchstens {n} Gruppen
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>
    </div>
  );
}
