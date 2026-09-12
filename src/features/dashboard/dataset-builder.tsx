import { ChevronDownIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { IconButton } from "@/components/icon-button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { queryErrorMessage } from "@/lib/connection-url";
import { useActiveConnection } from "@/lib/connections";
import { type Dataset, datasetShape, toLabel } from "@/lib/dashboards";
import { defaultFlow } from "@/lib/dataset-flow";
import { cn } from "@/lib/utils";
import { adoptSimple } from "./dataset-adopt";
import { ExpertBuilder } from "./expert-dataset-builder";
import { FlowBuilder } from "./flow-builder";

import { SimpleBuilder } from "./simple-dataset-builder";
import { useDatasetSql, useDebounced, useSqlQuery } from "./use-dataset-query";
export function DatasetBuilder({
  dataset: stored,
  onChange: commit,
  onDelete,
}: {
  dataset: Dataset;
  onChange: (patch: Partial<Dataset>) => void;
  onDelete: () => void;
}) {
  const dataset = stored;
  const onChange = commit;
  const connection = useActiveConnection();
  const [showSql, setShowSql] = useState(false);
  const [expertRun, setExpertRun] = useState(0);
  const liveSql = useDatasetSql(dataset, "all");
  const debouncedSql = useDebounced(liveSql);
  const [runSql, setRunSql] = useState("");
  const sql = dataset.mode === "expert" ? runSql : debouncedSql;
  const preview = useSqlQuery(sql);
  const resultColumns = preview.data?.columns ?? [];
  const shape = datasetShape(dataset);

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
              Geführt
            </TabsTrigger>
            <TabsTrigger value="flow" className="h-6 px-2 text-[11px]">
              Beziehungen
            </TabsTrigger>
            <TabsTrigger value="expert" className="h-6 px-2 text-[11px]">
              SQL
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <IconButton
          variant="ghost"
          size="icon-sm"
          aria-label="Datensatz löschen"
          onClick={onDelete}
        >
          <Trash2Icon />
        </IconButton>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto p-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)]">
        <div className="min-w-0">
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
        </div>
        <section className="min-w-0 self-start overflow-hidden rounded-xl border bg-card/60 xl:sticky xl:top-0">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Deine gesammelten Daten</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Prüfe das Ergebnis bei jedem Schritt. Ein Datensatz kann mehrere Charts versorgen.
            </p>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-semibold">Vorschau</span>
            <span className="text-[11px] text-muted-foreground">
              {!sql
                ? liveSql
                  ? "Vorschau wird vorbereitet…"
                  : "Noch keine Abfrage"
                : preview.isFetching
                  ? "Lädt…"
                  : preview.isError
                    ? "Fehler"
                    : preview.data
                      ? `${preview.data.rows.length} Zeilen · ${Math.round(preview.data.execution_time_ms)} ms`
                      : ""}
            </span>
          </div>
          {!liveSql && (
            <p className="p-6 text-sm text-muted-foreground">
              Wähle links eine Tabelle oder View, um die ersten Daten zu sehen.
            </p>
          )}
          {preview.data && preview.data.rows.length === 0 && (
            <p className="p-6 text-sm text-muted-foreground">
              Keine passenden Daten. Prüfe deine Filter oder wähle eine andere Quelle.
            </p>
          )}
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
                        {shape.metrics.find((m) => m.key === c)?.label ??
                          (c === shape.dimension
                            ? "Aufteilung"
                            : c === shape.dimension2
                              ? "Zweite Aufteilung"
                              : c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.data.rows.slice(0, 20).map((row, i) => (
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
