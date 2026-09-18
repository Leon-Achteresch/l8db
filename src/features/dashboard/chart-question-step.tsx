import { XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BUCKET_LABEL,
  type Dataset,
  isDateType,
  joinRef,
  type SimpleDataset,
  type TimeBucket,
} from "@/lib/dashboards";
import { useDetailedColumnsQuery } from "@/lib/queries";
import { filterOperatorLabel, parseFilterList } from "@/lib/sql-filter";
import { ChartFilterEditor, type ChartFilterField } from "./chart-filter-editor";
import type { ColumnOpt } from "./chart-question-step/constants";
import { ChartExpertMapping } from "./chart-question-step/expert-mapping";
import { ChartMetricsSection } from "./chart-question-step/metrics-section";
import { ChartSortLimitSection } from "./chart-question-step/sort-limit-section";
import { ColumnSelect } from "./dataset-column-select";

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
  const base = useDetailedColumnsQuery(s.schema, s.table);
  const joined = useDetailedColumnsQuery(s.join?.schema ?? "", s.join?.table ?? "");
  const [filterDraft, setFilterDraft] = useState<{
    field: ChartFilterField;
    filterId?: string;
  } | null>(null);

  const columns = useMemo<ColumnOpt[]>(
    () => [
      ...(base.data ?? []).map((c) => ({ ref: c.name, label: c.name, type: c.data_type })),
      ...(s.join
        ? (joined.data ?? []).map((c) => ({
            ref: joinRef(c.name),
            label: `${s.join?.table}.${c.name}`,
            type: c.data_type,
          }))
        : []),
    ],
    [base.data, joined.data, s.join],
  );
  const typeOf = (ref: string | null | undefined) => columns.find((c) => c.ref === ref)?.type ?? "";
  const fieldOf = (ref: string): ChartFilterField => ({
    ref,
    label: columns.find((c) => c.ref === ref)?.label ?? ref,
    dataType: typeOf(ref),
  });

  if (dataset.mode === "expert") {
    return (
      <ChartExpertMapping
        mapping={dataset.mapping}
        resultColumns={resultColumns}
        onChange={onChange}
      />
    );
  }

  const patchSimple = (patch: Partial<SimpleDataset>) => onChange({ simple: { ...s, ...patch } });

  return (
    <div className="space-y-6">
      <ChartMetricsSection s={s} columns={columns} typeOf={typeOf} patchSimple={patchSimple} />

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
            simple={s}
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

      <ChartSortLimitSection s={s} patchSimple={patchSimple} />
    </div>
  );
}
