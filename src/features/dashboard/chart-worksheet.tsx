import { ArrowLeftRightIcon, Redo2Icon, Undo2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
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
  emptySource,
  type FieldPlacement,
  fieldPlacement,
  placeField,
  ROW_COUNT_FIELD,
  type ShelfId,
  shelfRole,
  updateWorksheet,
  type WorksheetField,
  type WorksheetSnapshot,
  worksheetFilterGroups,
  worksheetShelves,
} from "@/lib/chart-worksheet";
import {
  AGG_LABEL,
  type Agg,
  BUCKET_LABEL,
  chartFits,
  type Dashboard,
  type DatasetFilter,
  datasetShape,
  emptyDataset,
  isDateType,
  isNumericType,
  joinRef,
  PERIOD_LABEL,
  type Period,
  type SimpleDataset,
  type TimeBucket,
  useDashboardsStore,
  type Widget,
  widgetOptions,
} from "@/lib/dashboards";
import { useDetailedColumnsQuery } from "@/lib/queries";
import { filterOperatorLabel, parseFilterList } from "@/lib/sql-filter";
import { DatasetBuilder } from "./dataset-builder";
import { FieldShelf } from "./field-shelf";
import { WidgetCard } from "./widget-card";
import { WorksheetAppearance } from "./worksheet-appearance";
import { WorksheetFields } from "./worksheet-fields";
import { WorksheetFilterEditor } from "./worksheet-filter-editor";
import { WorksheetPill } from "./worksheet-pill";

export function ChartWorksheet({ dashboard, widget }: { dashboard: Dashboard; widget: Widget }) {
  const [fallback] = useState(() => emptyDataset(widget.title));
  const dataset = dashboard.datasets.find((d) => d.id === widget.datasetId) ?? fallback;
  const snapshot = { dataset, widget };
  const s = dataset.simple;
  const [past, setPast] = useState<WorksheetSnapshot[]>([]);
  const [future, setFuture] = useState<WorksheetSnapshot[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [filterDraft, setFilterDraft] = useState<{
    field: WorksheetField;
    filter?: DatasetFilter;
  } | null>(null);
  const base = useDetailedColumnsQuery(s.schema, s.table);
  const joined = useDetailedColumnsQuery(s.join?.schema ?? "", s.join?.table ?? "");
  const options = widgetOptions(widget);
  const fields = useMemo<WorksheetField[]>(
    () => [
      ...(base.data ?? []).map((c) => ({ ref: c.name, label: c.name, dataType: c.data_type })),
      ...(s.join
        ? (joined.data ?? []).map((c) => ({
            ref: joinRef(c.name),
            label: `${s.join?.table}.${c.name}`,
            dataType: c.data_type,
          }))
        : []),
      ...(s.table ? [{ ref: ROW_COUNT_FIELD, label: "Anzahl Zeilen", dataType: "integer" }] : []),
    ],
    [base.data, joined.data, s.join, s.table],
  );
  const getField = (ref: string): WorksheetField =>
    fields.find((f) => f.ref === ref) ?? { ref, label: ref, dataType: "" };
  const apply = (next: WorksheetSnapshot) =>
    useDashboardsStore.getState().update(dashboard.id, (d) => updateWorksheet(d, widget.id, next));
  const commit = (next: WorksheetSnapshot) => {
    if (JSON.stringify(snapshot) === JSON.stringify(next)) return;
    setPast((history) => [...history.slice(-29), structuredClone(snapshot)]);
    setFuture([]);
    apply(next);
  };
  const changeSimple = (patch: Partial<SimpleDataset>) =>
    commit({
      dataset: { ...dataset, simple: { ...s, ...patch } },
      widget: { ...widget, options: { ...widget.options, metricKeys: null } },
    });
  const changeWidget = (patch: Partial<Widget>) =>
    commit({ dataset, widget: { ...widget, ...patch } });
  const place = (field: WorksheetField, target?: ShelfId, placement?: FieldPlacement) => {
    if (!s.table || dataset.mode !== "simple") return;
    const numeric = isNumericType(field.dataType) || field.ref === ROW_COUNT_FIELD;
    const auto =
      widget.chart === "scatter"
        ? numeric
          ? !s.metrics[0]?.column
            ? "columns"
            : "rows"
          : "color"
        : numeric
          ? options.horizontal && widget.chart === "column"
            ? "columns"
            : "rows"
          : options.horizontal && widget.chart === "column"
            ? "rows"
            : "columns";
    const shelf = target ?? auto;
    if (shelf === "filters") {
      if (field.ref === ROW_COUNT_FIELD) {
        toast.info(
          "Wähle zum Filtern ein Feld aus deiner Tabelle, zum Beispiel Datum oder Betrag.",
        );
        return;
      }
      setFilterDraft({ field, filter: s.filters.find((f) => f.column === field.ref) });
      return;
    }
    commit(placeField(snapshot, field, shelf, placement));
  };
  const drop = (shelf: ShelfId, data: string) => {
    const parsed = fieldPlacement(data, widget.id, fields);
    if (parsed) place(parsed.field, shelf, parsed.placement);
  };
  const shape = datasetShape(dataset);
  const shelves = worksheetShelves(widget);
  if (
    s.dimension2 &&
    !shelves.some((shelf) => shelfRole(widget.chart, shelf.id, options.horizontal) === "dimension2")
  )
    shelves.push({ id: "color", label: "Weitere Aufteilung", hint: "" });
  const unsupportedColor =
    !!s.dimension2 &&
    !worksheetShelves(widget).some(
      (shelf) => shelfRole(widget.chart, shelf.id, options.horizontal) === "dimension2",
    );
  const problem = unsupportedColor
    ? "Entferne die weitere Aufteilung oder wähle einen Chart-Typ, der zwei Kategorien unterstützt."
    : !s.table
      ? "Wähle links eine Tabelle oder View."
      : widget.chart === "scatter" && (!s.metrics[0]?.column || !s.metrics[1]?.column)
        ? "Lege je ein Zahlenfeld auf Spalten und Zeilen."
        : chartFits(widget.chart, shape);
  const undo = () => {
    const previous = past.at(-1);
    if (!previous) return;
    setPast(past.slice(0, -1));
    setFuture([structuredClone(snapshot), ...future]);
    setFilterDraft(null);
    apply(previous);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture(future.slice(1));
    setPast([...past, structuredClone(snapshot)]);
    setFilterDraft(null);
    apply(next);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <IconButton
          aria-label="Änderung rückgängig machen"
          variant="ghost"
          size="icon-sm"
          disabled={!past.length}
          onClick={undo}
        >
          <Undo2Icon />
        </IconButton>
        <IconButton
          aria-label="Änderung wiederholen"
          variant="ghost"
          size="icon-sm"
          disabled={!future.length}
          onClick={redo}
        >
          <Redo2Icon />
        </IconButton>
        {widget.chart === "column" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              changeWidget({ options: { ...widget.options, horizontal: !options.horizontal } })
            }
          >
            <ArrowLeftRightIcon />
            Achsen tauschen
          </Button>
        )}
        <p className="ml-auto text-xs text-muted-foreground">
          Änderungen werden automatisch gespeichert · Nur dieser Chart wird bearbeitet
        </p>
      </div>
      {advanced || dataset.mode !== "simple" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b p-3">
            <p className="text-sm">Erweiterte Datenquelle für {widget.title}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (dataset.mode === "simple") setAdvanced(false);
                else setAdvanced(!advanced);
              }}
            >
              {dataset.mode === "simple"
                ? "Zurück zum Chart"
                : advanced
                  ? "Chart-Vorschau"
                  : "Datenquelle bearbeiten"}
            </Button>
          </div>
          {advanced || dataset.mode === "simple" ? (
            <DatasetBuilder
              key={dataset.id}
              dataset={dataset}
              onChange={(patch) => commit({ dataset: { ...dataset, ...patch }, widget })}
              onDelete={() => {
                if (window.confirm("Datenquelle dieses Charts zurücksetzen?"))
                  commit({ dataset: emptyDataset(widget.title), widget });
              }}
            />
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-[1fr_260px]">
              <div className="p-6">
                <div className="h-[440px]">
                  <WidgetCard dashboardId={dashboard.id} widgetId={widget.id} preview />
                </div>
              </div>
              <WorksheetAppearance
                widget={widget}
                shape={shape}
                onChange={changeWidget}
                onAdvanced={() => setAdvanced(true)}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)] grid-rows-[minmax(650px,1fr)_auto] overflow-auto xl:grid-rows-1 xl:grid-cols-[240px_minmax(0,1fr)_240px]">
          <WorksheetFields
            dataset={dataset}
            chartId={widget.id}
            fields={fields}
            loading={base.isFetching || Boolean(s.join && joined.isFetching)}
            error={base.error || (s.join && joined.error)}
            onRetry={() => {
              void base.refetch();
              if (s.join) void joined.refetch();
            }}
            onSource={(schema, table) => {
              if (schema === s.schema && table === s.table) return;
              setFilterDraft(null);
              commit({
                dataset: { ...dataset, simple: emptySource(s, schema, table) },
                widget: {
                  ...widget,
                  period: "all",
                  options: { ...widget.options, metricKeys: null },
                },
              });
            }}
            onJoin={(join) => {
              const valid = (ref: string) => !ref.startsWith("join:");
              changeSimple({
                join,
                dimension: s.dimension && valid(s.dimension.column) ? s.dimension : null,
                dimension2: s.dimension2 && valid(s.dimension2) ? s.dimension2 : null,
                metrics: s.metrics.filter((m) => !m.column || valid(m.column)),
                filters: s.filters.filter((f) => valid(f.column)),
                dateColumn: s.dateColumn && valid(s.dateColumn) ? s.dateColumn : null,
              });
            }}
            onPlace={place}
            targets={shelves}
          />
          <main
            aria-label="Chart-Arbeitsblatt"
            className="flex min-h-0 min-w-0 flex-col overflow-y-auto bg-muted/15"
          >
            <div className="space-y-2 border-b p-4">
              <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                Was möchtest du sehen? Ziehe eine Kategorie und eine Kennzahl hierher – zum Beispiel{" "}
                <strong>Monat</strong> und <strong>Umsatz</strong>.
              </p>
              {shelves.map((shelf) => {
                const role =
                  shelf.id === "color" && shelf.label === "Weitere Aufteilung"
                    ? "dimension2"
                    : shelfRole(widget.chart, shelf.id, options.horizontal);
                const ref =
                  role === "dimension"
                    ? s.dimension?.column
                    : role === "dimension2"
                      ? s.dimension2
                      : null;
                const metricIndices =
                  role === "metric"
                    ? widget.chart === "scatter"
                      ? [shelf.id === "columns" ? 0 : shelf.id === "rows" ? 1 : 2]
                      : s.metrics.map((_, index) => index)
                    : [];
                const label =
                  shelf.id === "columns" && widget.chart !== "scatter" && widget.chart !== "sankey"
                    ? `${shelf.label} · ${role === "metric" ? "Kennzahlen" : "Kategorien"}`
                    : shelf.id === "rows" && widget.chart !== "scatter" && widget.chart !== "sankey"
                      ? `${shelf.label} · ${role === "metric" ? "Kennzahlen" : "Kategorien"}`
                      : shelf.label;
                return (
                  <FieldShelf
                    key={`${shelf.id}:${shelf.label}`}
                    label={label}
                    hint={shelf.hint}
                    disabled={!s.table}
                    onDrop={(data) => drop(shelf.id, data)}
                  >
                    {ref ? (
                      <WorksheetPill
                        label={`${role === "dimension" && s.dimension?.bucket !== "none" ? `${BUCKET_LABEL[s.dimension?.bucket ?? "none"]} · ` : ""}${getField(ref).label}`}
                        placement={{ fieldRef: ref, chartId: widget.id, from: shelf.id }}
                        onRemove={() =>
                          changeSimple(
                            role === "dimension" ? { dimension: null } : { dimension2: null },
                          )
                        }
                      >
                        {role === "dimension" &&
                        (isDateType(getField(ref).dataType) || s.dimension?.bucket !== "none") ? (
                          <>
                            <p className="text-xs font-medium">
                              Wie möchtest du das Datum zusammenfassen?
                            </p>
                            <Select
                              value={s.dimension?.bucket ?? "none"}
                              onValueChange={(bucket) =>
                                changeSimple({
                                  dimension: { column: ref, bucket: bucket as TimeBucket },
                                })
                              }
                            >
                              <SelectTrigger aria-label="Datumsgruppierung">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(BUCKET_LABEL).map(([key, label]) => (
                                  <SelectItem key={key} value={key}>
                                    {label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Jeder unterschiedliche Wert bildet eine eigene Kategorie. Ziehe das Feld
                            auf eine andere Ablage, um seine Rolle zu ändern.
                          </p>
                        )}
                      </WorksheetPill>
                    ) : metricIndices.some(
                        (i) => s.metrics[i]?.column || s.metrics[i]?.agg === "count",
                      ) ? (
                      metricIndices.map((i) => {
                        const metric = s.metrics[i];
                        if (!metric || (!metric.column && metric.agg !== "count")) return null;
                        const field = getField(metric.column ?? ROW_COUNT_FIELD);
                        const title =
                          metric.label ||
                          (metric.column
                            ? `${AGG_LABEL[metric.agg]} · ${field.label}`
                            : "Anzahl Zeilen");
                        return (
                          <WorksheetPill
                            key={metric.id}
                            label={title}
                            measure
                            placement={{
                              fieldRef: field.ref,
                              chartId: widget.id,
                              from: shelf.id,
                              metricId: metric.id,
                            }}
                            onRemove={() =>
                              changeSimple({
                                metrics:
                                  widget.chart === "scatter"
                                    ? s.metrics.map((m, index) =>
                                        index === i ? { ...m, column: null, agg: "avg" } : m,
                                      )
                                    : s.metrics.filter((m) => m.id !== metric.id),
                              })
                            }
                          >
                            <p className="text-xs font-medium">
                              Wie soll {field.label} berechnet werden?
                            </p>
                            <Select
                              value={metric.agg}
                              onValueChange={(agg) =>
                                changeSimple({
                                  metrics: s.metrics.map((m) =>
                                    m.id === metric.id ? { ...m, agg: agg as Agg } : m,
                                  ),
                                })
                              }
                            >
                              <SelectTrigger aria-label={`Berechnung ${field.label}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(Object.keys(AGG_LABEL) as Agg[])
                                  .filter((agg) =>
                                    !metric.column
                                      ? agg === "count"
                                      : isNumericType(field.dataType) ||
                                        !["sum", "avg"].includes(agg),
                                  )
                                  .map((agg) => (
                                    <SelectItem key={agg} value={agg}>
                                      {AGG_LABEL[agg]}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                            <p className="text-[11px] text-muted-foreground">
                              Summe addiert Werte. Durchschnitt zeigt den Mittelwert. Anzahl zählt
                              Einträge.
                            </p>
                            <label
                              htmlFor={`metric-label-${metric.id}`}
                              className="space-y-1 text-xs"
                            >
                              <span>Bezeichnung im Chart</span>
                              <Input
                                id={`metric-label-${metric.id}`}
                                value={metric.label}
                                placeholder={title}
                                onChange={(e) =>
                                  changeSimple({
                                    metrics: s.metrics.map((m) =>
                                      m.id === metric.id ? { ...m, label: e.target.value } : m,
                                    ),
                                  })
                                }
                              />
                            </label>
                            {i > 0 && widget.chart !== "scatter" && (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => {
                                  const metrics = [...s.metrics];
                                  [metrics[i - 1], metrics[i]] = [metrics[i], metrics[i - 1]];
                                  changeSimple({ metrics });
                                }}
                              >
                                Eine Position nach vorne
                              </Button>
                            )}
                          </WorksheetPill>
                        );
                      })
                    ) : null}
                  </FieldShelf>
                );
              })}
              <FieldShelf
                label="Filter · Welche Daten zeigen?"
                hint="Feld hier ablegen, dann Werte oder Bedingung wählen"
                disabled={!s.table}
                onDrop={(data) => drop("filters", data)}
              >
                {s.filters.length
                  ? worksheetFilterGroups(s.filters).map((group) => {
                      const filter = group[0];
                      const field = getField(filter.column);
                      const label = `${field.label} ${group.map((f) => `${filterOperatorLabel(f.operator, true)} ${["in", "notIn"].includes(f.operator) ? parseFilterList(f.value).join(", ") : f.value}`).join(" und ")}`;
                      return (
                        <WorksheetPill
                          key={filter.id}
                          label={label}
                          placement={{ fieldRef: field.ref, chartId: widget.id, from: "filters" }}
                          onEdit={() => setFilterDraft({ field, filter })}
                          onRemove={() =>
                            changeSimple({
                              filters: s.filters.filter(
                                (f) => !group.some((item) => item.id === f.id),
                              ),
                            })
                          }
                        />
                      );
                    })
                  : null}
              </FieldShelf>
              {filterDraft && (
                <WorksheetFilterEditor
                  key={filterDraft.filter?.id ?? filterDraft.field.ref}
                  field={filterDraft.field}
                  simple={s}
                  filter={filterDraft.filter}
                  onCancel={() => setFilterDraft(null)}
                  onApply={(filters) => {
                    const old = filterDraft.filter;
                    changeSimple({
                      filters: [
                        ...s.filters.filter((f) =>
                          old
                            ? f.id !== old.id && (!old.rangeId || f.rangeId !== old.rangeId)
                            : true,
                        ),
                        ...filters,
                      ],
                    });
                    setFilterDraft(null);
                  }}
                />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
              <Select
                value={s.sort}
                onValueChange={(sort) => changeSimple({ sort: sort as SimpleDataset["sort"] })}
              >
                <SelectTrigger aria-label="Chart sortieren" className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dimension">Kategorien sortieren</SelectItem>
                  <SelectItem value="metric_desc">Größte Werte zuerst</SelectItem>
                  <SelectItem value="metric_asc">Kleinste Werte zuerst</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={String(s.limit)}
                onValueChange={(limit) => changeSimple({ limit: Number(limit) })}
              >
                <SelectTrigger aria-label="Anzahl angezeigter Ergebnisse" className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([10, 25, 50, 100, 500, 1000, s.limit])]
                    .sort((a, b) => a - b)
                    .map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        Bis zu {n} Ergebnisse
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {s.dateColumn && (
                <Select
                  value={widget.period}
                  onValueChange={(period) => changeWidget({ period: period as Period })}
                >
                  <SelectTrigger aria-label="Chart-Zeitraum" className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PERIOD_LABEL).map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="min-h-[360px] flex-1 p-5">
              {problem ? (
                <div className="grid h-full min-h-72 place-items-center rounded-xl border border-dashed bg-card p-8">
                  <div className="max-w-md text-center">
                    <h2 className="text-lg font-semibold">
                      {!s.table
                        ? "Welche Daten soll dein Chart zeigen?"
                        : !shape.metrics.length
                          ? "Was möchtest du messen?"
                          : "Wie möchtest du die Werte aufteilen?"}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {!s.table
                        ? "Wähle links eine Tabelle oder View. Du brauchst dafür kein SQL."
                        : !shape.metrics.length
                          ? "Ziehe eine Zahl aus den Kennzahlen auf Zeilen. Für eine einfache Zählung nutze „Anzahl Zeilen“."
                          : problem.replace(
                              "Braucht eine Aufteilung (Dimension)",
                              "Ziehe eine Kategorie oder ein Datum auf Spalten, zum Beispiel Land oder Bestelldatum.",
                            )}
                    </p>
                    <p className="mt-4 text-xs text-muted-foreground">
                      Tipp: Ein Doppelklick auf ein Feld ordnet es automatisch zu.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="h-full min-h-[340px]">
                  <WidgetCard
                    key={widget.id}
                    dashboardId={dashboard.id}
                    widgetId={widget.id}
                    preview
                  />
                </div>
              )}
            </div>
            {!problem && (
              <p className="px-5 pb-4 text-xs text-muted-foreground">
                {shape.metrics.map((m) => m.label).join(" · ")}
                {s.dimension
                  ? ` nach ${getField(s.dimension.column).label}${s.dimension.bucket !== "none" ? ` (${BUCKET_LABEL[s.dimension.bucket]})` : ""}`
                  : ""}
                {s.filters.length
                  ? ` · ${s.filters.length} Filter aktiv`
                  : " · Alle Werte der Quelle"}
              </p>
            )}
          </main>
          <div className="col-span-2 min-h-0 xl:col-span-1">
            <WorksheetAppearance
              widget={widget}
              shape={shape}
              onChange={changeWidget}
              onAdvanced={() => setAdvanced(true)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
