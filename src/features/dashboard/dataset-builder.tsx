import {
  CheckIcon,
  ChevronDownIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { queryErrorMessage } from "@/lib/connection-url";
import { useActiveConnection } from "@/lib/connections";
import {
  AGG_LABEL,
  type Agg,
  BUCKET_LABEL,
  createId,
  type Dataset,
  type DatasetMetric,
  DIM_KEY,
  DIM2_KEY,
  datasetShape,
  datasetSql,
  emptySimple,
  isDateType,
  isNumericType,
  joinRef,
  metricKey,
  type SimpleDataset,
  type SortMode,
  type TimeBucket,
  toLabel,
} from "@/lib/dashboards";
import { defaultFlow } from "@/lib/dataset-flow";
import type { DatabaseKind } from "@/lib/db";
import { useActiveSchema } from "@/lib/db-selection";
import { supports } from "@/lib/providers";
import { useDetailedColumnsQuery, useTablesQuery, useViewsQuery } from "@/lib/queries";
import { OPERATORS, operatorNeedsValue } from "@/lib/sql-filter";
import { cn } from "@/lib/utils";
import { FlowBuilder } from "./flow-builder";
import { SqlEditor } from "./sql-editor";
import { useDatasetSql, useDebounced, useRelations, useSqlQuery } from "./use-dataset-query";

interface ColumnOpt {
  ref: string;
  label: string;
  type: string;
}

const NONE = "__none__";

function ColumnSelect({
  value,
  onChange,
  columns,
  placeholder = "Spalte wählen",
  allowNone,
  filter,
  className,
}: {
  value: string | null;
  onChange: (ref: string | null) => void;
  columns: ColumnOpt[];
  placeholder?: string;
  allowNone?: string;
  filter?: (col: ColumnOpt) => boolean;
  className?: string;
}) {
  const list = filter ? columns.filter(filter) : columns;
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger size="sm" className={cn("h-8 w-full text-xs", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent searchable>
        {allowNone && <SelectItem value={NONE}>{allowNone}</SelectItem>}
        {list.map((col) => (
          <SelectItem key={col.ref} value={col.ref}>
            <span className="truncate">{col.label}</span>
            <span className="ml-auto pl-2 font-mono text-[10px] text-muted-foreground">
              {col.type}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Step({
  n,
  title,
  hint,
  done,
  optional,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  done: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card/60 p-3">
      <div className="mb-1 flex items-center gap-2">
        <span
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
            done ? "bg-lime-400 text-lime-950" : "bg-muted text-muted-foreground",
          )}
        >
          {done ? <CheckIcon className="size-3" /> : n}
        </span>
        <h3 className="text-xs font-semibold">{title}</h3>
        {optional && <span className="text-[10px] text-muted-foreground">optional</span>}
      </div>
      <p className="mb-2.5 pl-7 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
      <div className="space-y-2 pl-7">{children}</div>
    </section>
  );
}

function SimpleBuilder({
  dataset,
  onChange,
}: {
  dataset: Dataset;
  onChange: (patch: Partial<SimpleDataset>) => void;
}) {
  const s = dataset.simple;
  const connection = useActiveConnection();
  const schema = useActiveSchema();
  const tables = useTablesQuery();
  const views = useViewsQuery();
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
    <div className="space-y-2.5">
      <Step
        n={1}
        title="Woher kommen die Daten?"
        hint="Wähle eine Tabelle oder View, die deine Daten enthält. Bei Tabellen kannst du eine verknüpfte Tabelle einbeziehen: übergeordnete (z. B. Kunde zum Auftrag) oder untergeordnete (z. B. Positionen zum Auftrag)."
        done={Boolean(s.table)}
      >
        <Select
          value={s.table || NONE}
          onValueChange={(table) => onChange({ ...emptySimple(), schema, table })}
        >
          <SelectTrigger size="sm" className="h-8 w-full text-xs">
            <SelectValue placeholder="Tabelle oder View wählen" />
          </SelectTrigger>
          <SelectContent searchable>
            <SelectGroup>
              <SelectLabel>Tabellen</SelectLabel>
              {(tables.data ?? []).map((t) => (
                <SelectItem key={`t:${t.schema}.${t.name}`} value={t.name}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectGroup>
            {(views.data?.length ?? 0) > 0 && (
              <SelectGroup>
                <SelectLabel>Views</SelectLabel>
                {(views.data ?? []).map((v) => (
                  <SelectItem key={`v:${v.schema}.${v.name}`} value={v.name}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
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
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Kennzahl entfernen"
                  onClick={() => onChange({ metrics: s.metrics.filter((x) => x.id !== m.id) })}
                >
                  <XIcon />
                </Button>
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
                    x.id === f.id ? { ...x, column: column ?? "" } : x,
                  ),
                })
              }
              columns={columns}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Filter entfernen"
              onClick={() => onChange({ filters: s.filters.filter((x) => x.id !== f.id) })}
            >
              <XIcon />
            </Button>
            <div className="col-span-2 flex gap-1.5">
              <Select
                value={f.operator}
                onValueChange={(operator) =>
                  onChange({
                    filters: s.filters.map((x) => (x.id === f.id ? { ...x, operator } : x)),
                  })
                }
              >
                <SelectTrigger size="sm" className="h-8 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPERATORS.map((op) => (
                    <SelectItem key={op.key} value={op.key}>
                      {op.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {operatorNeedsValue(f.operator) && (
                <Input
                  className="h-8 flex-1 text-xs"
                  placeholder="Wert"
                  value={f.value}
                  onChange={(e) =>
                    onChange({
                      filters: s.filters.map((x) =>
                        x.id === f.id ? { ...x, value: e.target.value } : x,
                      ),
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
    </div>
  );
}

function adoptSimple(dataset: Dataset, kind: DatabaseKind | null): Partial<Dataset> {
  const from: Dataset["mode"] = dataset.mode === "flow" ? "flow" : "simple";
  const shape = datasetShape({ ...dataset, mode: from });
  return {
    sql: datasetSql({ ...dataset, mode: from }, kind, "all"),
    mapping: {
      dimension: shape.dimension ? DIM_KEY : null,
      dimension2: shape.dimension2 ? DIM2_KEY : null,
      metrics: shape.metrics.map((_, i) => metricKey(i)),
      dateColumn: null,
    },
  };
}

function ExpertBuilder({
  dataset,
  onChange,
  columns,
  onRun,
}: {
  dataset: Dataset;
  onChange: (patch: Partial<Dataset>) => void;
  columns: string[];
  onRun: () => void;
}) {
  const connection = useActiveConnection();
  const m = dataset.mapping;
  const setMapping = (patch: Partial<Dataset["mapping"]>) =>
    onChange({ mapping: { ...m, ...patch } });
  return (
    <div className="space-y-2.5">
      <section className="overflow-hidden rounded-xl border bg-card/60">
        <div className="flex items-center justify-between border-b px-3 py-1.5">
          <span className="text-xs font-semibold">SQL</span>
          <div className="flex gap-1">
            {(dataset.simple.table || dataset.flow) && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => onChange(adoptSimple(dataset, connection?.kind ?? null))}
              >
                <WandSparklesIcon /> Aus Builder übernehmen
              </Button>
            )}
            <Button size="xs" onClick={onRun}>
              <PlayIcon /> Ausführen
            </Button>
          </div>
        </div>
        <SqlEditor value={dataset.sql} onChange={(sql) => onChange({ sql })} className="h-48" />
      </section>
      <section className="rounded-xl border bg-card/60 p-3">
        <h3 className="text-xs font-semibold">Spalten zuordnen</h3>
        <p className="mt-0.5 mb-2 text-[11px] text-muted-foreground">
          {columns.length
            ? "Lege fest, welche Ergebnisspalte die Aufteilung ist und welche die Kennzahlen sind."
            : "Führe die Abfrage aus, damit die Spalten zugeordnet werden können."}
        </p>
        {columns.length > 0 && (
          <div className="space-y-2">
            <MappingSelect
              label="Aufteilung"
              value={m.dimension}
              columns={columns}
              onChange={(dimension) => setMapping({ dimension })}
            />
            <MappingSelect
              label="Zweite Aufteilung (Fluss)"
              value={m.dimension2}
              columns={columns}
              onChange={(dimension2) => setMapping({ dimension2 })}
            />
            <MappingSelect
              label="Zeitspalte"
              value={m.dateColumn}
              columns={columns}
              onChange={(dateColumn) => setMapping({ dateColumn })}
            />
            <div>
              <p className="mb-1 text-[11px] text-muted-foreground">Kennzahlen</p>
              <div className="flex flex-wrap gap-1.5">
                {columns.map((col) => {
                  const active = m.metrics.includes(col);
                  return (
                    <button
                      type="button"
                      key={col}
                      aria-pressed={active}
                      onClick={() =>
                        setMapping({
                          metrics: active
                            ? m.metrics.filter((x) => x !== col)
                            : [...m.metrics, col],
                        })
                      }
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px]",
                        active && "border-lime-400 bg-lime-400/15 font-medium",
                      )}
                    >
                      {active && <CheckIcon className="size-3" />}
                      {col}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function MappingSelect({
  label,
  value,
  columns,
  onChange,
}: {
  label: string;
  value: string | null;
  columns: string[];
  onChange: (value: string | null) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] text-muted-foreground">{label}</p>
      <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
        <SelectTrigger size="sm" className="h-8 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Keine</SelectItem>
          {columns.map((col) => (
            <SelectItem key={col} value={col}>
              {col}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function DatasetBuilder({
  dataset: stored,
  onChange: commit,
  onDelete,
}: {
  dataset: Dataset;
  onChange: (patch: Partial<Dataset>) => void;
  onDelete: () => void;
}) {
  const [dataset, setDraft] = useState(stored);
  const pending = useRef<Partial<Dataset>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (Object.keys(pending.current).length) commitRef.current(pending.current);
    pending.current = {};
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);
  const onChange = (patch: Partial<Dataset>) => {
    setDraft((d) => ({ ...d, ...patch }));
    pending.current = { ...pending.current, ...patch };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 300);
  };
  const connection = useActiveConnection();
  const [showSql, setShowSql] = useState(false);
  const [expertRun, setExpertRun] = useState(0);
  const liveSql = useDatasetSql(dataset, "all");
  const debouncedSql = useDebounced(liveSql);
  const [runSql, setRunSql] = useState("");
  const sql = dataset.mode === "expert" ? runSql : debouncedSql;
  const preview = useSqlQuery(sql);
  const resultColumns = preview.data?.columns ?? [];

  const runExpert = () => {
    setRunSql(liveSql);
    setExpertRun((n) => n + 1);
    if (runSql === liveSql) void preview.refetch();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Input
          className="h-7 flex-1 text-xs font-medium"
          value={dataset.name}
          aria-label="Name des Datensatzes"
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <Tabs
          value={dataset.mode}
          onValueChange={(mode) =>
            onChange({
              mode: mode as Dataset["mode"],
              ...(mode === "expert" && !dataset.sql.trim() && (dataset.simple.table || dataset.flow)
                ? adoptSimple(dataset, connection?.kind ?? null)
                : {}),
              ...(mode === "flow" && !dataset.flow ? { flow: defaultFlow() } : {}),
            })
          }
        >
          <TabsList className="h-7">
            <TabsTrigger value="simple" className="h-6 px-2 text-[11px]">
              Einfach
            </TabsTrigger>
            <TabsTrigger value="flow" className="h-6 px-2 text-[11px]">
              Flow
            </TabsTrigger>
            <TabsTrigger value="expert" className="h-6 px-2 text-[11px]">
              Experte
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="ghost" size="icon-sm" aria-label="Datensatz löschen" onClick={onDelete}>
          <Trash2Icon />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {dataset.mode === "simple" ? (
          <SimpleBuilder
            dataset={dataset}
            onChange={(patch) => onChange({ simple: { ...dataset.simple, ...patch } })}
          />
        ) : dataset.mode === "flow" ? (
          <FlowBuilder dataset={dataset} onChange={onChange} />
        ) : (
          <ExpertBuilder
            dataset={dataset}
            onChange={onChange}
            columns={resultColumns}
            onRun={runExpert}
          />
        )}
        <section className="mt-2.5 rounded-xl border bg-card/60">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-semibold">Vorschau</span>
            <span className="text-[11px] text-muted-foreground">
              {!sql
                ? "Noch keine Abfrage"
                : preview.isFetching
                  ? "Lädt…"
                  : preview.isError
                    ? "Fehler"
                    : preview.data
                      ? `${preview.data.rows.length} Zeilen · ${Math.round(preview.data.execution_time_ms)} ms`
                      : ""}
            </span>
          </div>
          {preview.isError && (
            <p role="alert" className="border-t px-3 py-2 text-[11px] text-destructive">
              {queryErrorMessage(preview.error)}
            </p>
          )}
          {preview.data && preview.data.rows.length > 0 && (
            <div className="overflow-x-auto border-t">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    {preview.data.columns.map((c) => (
                      <th key={c} className="px-2 py-1 font-medium">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.data.rows.slice(0, 8).map((row, i) => (
                    <tr key={`${expertRun}:${i}`} className="border-t border-border/50">
                      {preview.data?.columns.map((c) => (
                        <td key={c} className="max-w-40 truncate px-2 py-1 tabular-nums">
                          {toLabel(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {dataset.mode !== "expert" && liveSql && (
            <div className="border-t">
              <button
                type="button"
                className="flex w-full items-center gap-1 px-3 py-1.5 text-[11px] text-muted-foreground"
                onClick={() => setShowSql((v) => !v)}
              >
                <ChevronDownIcon
                  className={cn("size-3 transition-transform", showSql && "rotate-180")}
                />
                Erzeugtes SQL
              </button>
              {showSql && (
                <pre className="overflow-x-auto px-3 pb-2 font-mono text-[11px] leading-relaxed">
                  {liveSql}
                </pre>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
