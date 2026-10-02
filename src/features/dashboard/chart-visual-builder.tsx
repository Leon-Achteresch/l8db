import { HashIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { IconButton } from "@/components/icon-button";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BUCKET_LABEL,
  createId,
  type Dataset,
  isDateType,
  type SimpleDataset,
  syncJoins,
  type TimeBucket,
} from "@/lib/dashboards";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { filterOperatorLabel, parseFilterList } from "@/lib/sql-filter";
import { ChartFieldLibrary } from "./chart-field-library";
import { ChartFieldZone } from "./chart-field-zone";
import { ChartFilterEditor, type ChartFilterField } from "./chart-filter-editor";
import { ChartSortLimitSection } from "./chart-question-step/sort-limit-section";
import {
  assignChartField,
  type ChartFieldTarget,
  updateChartMetric,
} from "./chart-visual-builder-model";
import { ChartVisualMetric } from "./chart-visual-metric";
import { ColumnSelect } from "./dataset-column-select";
import { type DatasetColumn, useDatasetColumns } from "./use-dataset-query";

export function ChartVisualBuilder({
  dataset,
  onChange,
}: {
  dataset: Dataset;
  onChange: (patch: Partial<Dataset>) => void;
}) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("dashboard.visual-builder");
  const simple = dataset.simple;
  const { columns, joins, loading } = useDatasetColumns(simple);
  const [selected, setSelected] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [filterDraft, setFilterDraft] = useState<{
    field: ChartFilterField;
    filterId?: string;
  } | null>(null);
  const selectedField = columns.find((field) => field.ref === selected);
  const patchSimple = (patch: Partial<SimpleDataset>) =>
    onChange({ simple: syncJoins({ ...simple, ...patch }, joins) });
  const fieldOf = (ref: string): ChartFilterField => {
    const field = columns.find((column) => column.ref === ref);
    return { ref, label: field?.label ?? ref, dataType: field?.type ?? "" };
  };
  const assign = (target: ChartFieldTarget, ref = selected) => {
    const field = columns.find((column) => column.ref === ref);
    if (!field) return;
    if (target === "filter") {
      setFilterDraft({ field: fieldOf(field.ref) });
      return;
    }
    const next = assignChartField(simple, field, target, createId());
    onChange({ simple: syncJoins(next, joins) });
    const targetLabel = {
      metric: "Kennzahlen",
      dimension: "Aufteilung",
      dimension2: "Zweite Aufteilung",
    }[target];
    setAnnouncement(`${field.label} wurde zu ${targetLabel} hinzugefügt.`);
  };
  const selectField = (field: DatasetColumn) => {
    setSelected(field.ref);
    setAnnouncement(`${field.label} ausgewählt. Wähle rechts, wie du das Feld verwenden möchtest.`);
  };

  return (
    <section aria-label="Visueller Datenbuilder" className="space-y-4">
      <div ref={feature.ref} className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Gestalte deine Daten</h2>
        {feature.isNew && <NewBadge />}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(170px,0.65fr)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-0">
          <ChartFieldLibrary
            columns={columns}
            loading={loading}
            selected={selected}
            onSelect={selectField}
          />
          {selectedField && (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">{selectedField.label}</span> ausgewählt.
              Rechts zuweisen oder ein weiteres Feld wählen.
            </p>
          )}
          {columns.some((field) => field.ref.startsWith("join:")) && (
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              Felder verknüpfter Tabellen verbinden wir automatisch.
            </p>
          )}
        </div>
        <div className="min-w-0 space-y-3">
          <ChartFieldZone
            title="Kennzahlen"
            hint="Was möchtest du messen? Zahlen werden summiert, Textwerte gezählt."
            selectedLabel={selectedField?.label}
            onAssign={() => assign("metric")}
            onDrop={(ref) => assign("metric", ref)}
          >
            <div className="space-y-2">
              {simple.metrics.map((metric) => (
                <ChartVisualMetric
                  key={metric.id}
                  metric={metric}
                  columns={columns}
                  removable={simple.metrics.length > 1}
                  onChange={(patch) =>
                    patchSimple({
                      metrics: simple.metrics.map((item) =>
                        item.id === metric.id ? updateChartMetric(item, patch) : item,
                      ),
                    })
                  }
                  onRemove={() =>
                    patchSimple({ metrics: simple.metrics.filter((item) => item.id !== metric.id) })
                  }
                />
              ))}
            </div>
            <Button
              variant="ghost"
              size="xs"
              onClick={() =>
                patchSimple({
                  metrics: [
                    ...simple.metrics,
                    { id: createId(), agg: "count", column: null, label: "" },
                  ],
                })
              }
            >
              <HashIcon /> Anzahl Zeilen hinzufügen
            </Button>
          </ChartFieldZone>
          <ChartFieldZone
            title="Aufteilung"
            hint="Ein Balken oder Punkt pro Kategorie oder Zeitraum."
            selectedLabel={selectedField?.label}
            onAssign={() => assign("dimension")}
            onDrop={(ref) => assign("dimension", ref)}
          >
            <ColumnSelect
              value={simple.dimension?.column ?? null}
              columns={columns}
              label="Aufteilung"
              allowNone="Gesamtwert, ohne Aufteilung"
              onChange={(ref) =>
                ref ? assign("dimension", ref) : patchSimple({ dimension: null, dimension2: null })
              }
            />
            {simple.dimension && isDateType(fieldOf(simple.dimension.column).dataType) && (
              <Select
                value={simple.dimension.bucket}
                onValueChange={(bucket) =>
                  patchSimple({
                    dimension: {
                      column: simple.dimension?.column ?? "",
                      bucket: bucket as TimeBucket,
                    },
                  })
                }
              >
                <SelectTrigger
                  size="sm"
                  aria-label="Datum zusammenfassen"
                  className="h-8 w-full text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(BUCKET_LABEL) as TimeBucket[]).map((bucket) => (
                    <SelectItem key={bucket} value={bucket}>
                      {BUCKET_LABEL[bucket]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </ChartFieldZone>
          <ChartFieldZone
            title="Zweite Aufteilung"
            hint="Vergleiche Gruppen innerhalb jeder Kategorie, z. B. Länder pro Monat."
            selectedLabel={selectedField?.label}
            onAssign={() => assign("dimension2")}
            onDrop={(ref) => assign("dimension2", ref)}
          >
            <ColumnSelect
              value={simple.dimension2}
              columns={columns.filter((field) => field.ref !== simple.dimension?.column)}
              label="Zweite Aufteilung"
              allowNone="Keine zweite Aufteilung"
              onChange={(dimension2) => patchSimple({ dimension2 })}
            />
          </ChartFieldZone>
          <ChartFieldZone
            title="Filter"
            hint="Zeige nur die Werte, die dich interessieren."
            selectedLabel={selectedField?.label}
            onAssign={() => assign("filter")}
            onDrop={(ref) => assign("filter", ref)}
          >
            <div className="space-y-2">
              {simple.filters.map((filter) => (
                <div key={filter.id} className="flex items-center gap-1 rounded-lg bg-muted/40">
                  <button
                    type="button"
                    onClick={() =>
                      setFilterDraft({ field: fieldOf(filter.column), filterId: filter.id })
                    }
                    className="min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="font-medium">{fieldOf(filter.column).label}</span>{" "}
                    <span className="break-all text-muted-foreground">
                      {filterOperatorLabel(filter.operator, true)}{" "}
                      {["in", "notIn"].includes(filter.operator)
                        ? parseFilterList(filter.value).join(", ")
                        : filter.value}
                    </span>
                  </button>
                  <IconButton
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Filter für ${fieldOf(filter.column).label} entfernen`}
                    onClick={() =>
                      patchSimple({
                        filters: simple.filters.filter(
                          (item) =>
                            item.id !== filter.id &&
                            (!filter.rangeId || item.rangeId !== filter.rangeId),
                        ),
                      })
                    }
                  >
                    <XIcon />
                  </IconButton>
                </div>
              ))}
              <ColumnSelect
                value={null}
                columns={columns}
                label="Filter hinzufügen"
                placeholder="Feld zum Filtern wählen…"
                onChange={(ref) => ref && assign("filter", ref)}
              />
            </div>
            {simple.filters.length === 0 && (
              <p className="text-[11px] text-muted-foreground">Alle Daten werden berücksichtigt.</p>
            )}
          </ChartFieldZone>
          {filterDraft && (
            <ChartFilterEditor
              key={filterDraft.filterId ?? filterDraft.field.ref}
              field={filterDraft.field}
              simple={syncJoins(simple, joins, [filterDraft.field.ref])}
              filter={simple.filters.find((filter) => filter.id === filterDraft.filterId)}
              onCancel={() => setFilterDraft(null)}
              onApply={(filters) => {
                const old = simple.filters.find((filter) => filter.id === filterDraft.filterId);
                patchSimple({
                  filters: [
                    ...simple.filters.filter((filter) =>
                      old
                        ? filter.id !== old.id && (!old.rangeId || filter.rangeId !== old.rangeId)
                        : true,
                    ),
                    ...filters,
                  ],
                });
                setFilterDraft(null);
              }}
            />
          )}
          <details className="rounded-xl border p-3">
            <summary className="cursor-pointer text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">
              Zeitraum und Reihenfolge
            </summary>
            <div className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <h3 className="text-xs font-medium">Datum für die Zeitraum-Auswahl</h3>
                <ColumnSelect
                  value={simple.dateColumn}
                  columns={columns}
                  filter={(field) => isDateType(field.type)}
                  allowNone="Kein Zeitraumfilter"
                  label="Datum für Zeitraumfilter"
                  onChange={(dateColumn) => patchSimple({ dateColumn })}
                />
              </div>
              <ChartSortLimitSection s={simple} patchSimple={patchSimple} />
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}
