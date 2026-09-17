import { BookmarkIcon, CheckIcon, DatabaseIcon, HelpCircleIcon, PaletteIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { makeChartFile } from "@/lib/chart-file";
import { useDashboardWorkspaceStore } from "@/lib/dashboard-workspace";
import {
  type Dataset,
  type DatasetShape,
  datasetShape,
  type Widget,
} from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import { ChartDataStep } from "./chart-data-step";
import { ChartPreviewTable } from "./chart-preview-table";
import { ChartQuestionStep } from "./chart-question-step";
import { ChartStyleStep } from "./chart-style-step";
import { useDatasetSql, useDebounced, useSqlQuery } from "./use-dataset-query";
import { WidgetCardInner } from "./widget-card-inner";

export interface ChartDraft {
  widget: Widget;
  dataset: Dataset;
}

const STEPS = [
  { id: 1, label: "Daten", question: "Woher kommen deine Daten?", icon: DatabaseIcon },
  { id: 2, label: "Frage", question: "Was möchtest du herausfinden?", icon: HelpCircleIcon },
  { id: 3, label: "Darstellung", question: "Wie soll dein Chart aussehen?", icon: PaletteIcon },
] as const;

function dataReady(dataset: Dataset): boolean {
  return dataset.mode === "expert" ? dataset.sql.trim().length > 0 : Boolean(dataset.simple.table);
}

function questionReady(dataset: Dataset): boolean {
  return dataset.mode === "expert"
    ? dataset.mapping.metrics.length > 0
    : dataset.simple.metrics.some((m) => m.agg === "count" || m.column);
}

const noop = () => {};

export function ChartDialog({
  open,
  onOpenChange,
  draft,
  isNew,
  onSave,
  onDelete,
  onDuplicate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: ChartDraft | null;
  isNew: boolean;
  onSave: (draft: ChartDraft) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
}) {
  const [state, setState] = useState<ChartDraft | null>(draft);
  const [step, setStep] = useState(1);
  useEffect(() => {
    if (open) {
      setState(draft ? structuredClone(draft) : null);
      setStep(1);
    }
  }, [open, draft]);

  const dataset = state?.dataset ?? null;
  const widget = state?.widget ?? null;
  const liveSql = useDatasetSql(dataset, widget?.period ?? "all");
  const sql = useDebounced(liveSql, dataset?.mode === "expert" ? 1200 : 500);
  const preview = useSqlQuery(sql);
  const shape: DatasetShape | null = useMemo(
    () => (dataset ? datasetShape(dataset) : null),
    [dataset],
  );

  if (!state || !dataset || !widget) return null;

  const stepReady = [true, dataReady(dataset), questionReady(dataset)];
  const canFinish = dataReady(dataset) && questionReady(dataset);
  const patchDataset = (patch: Partial<Dataset>) =>
    setState((s) => (s ? { ...s, dataset: { ...s.dataset, ...patch } } : s));
  const patchWidget = (patch: Partial<Widget>) =>
    setState((s) => (s ? { ...s, widget: { ...s.widget, ...patch } } : s));
  const resultColumns = preview.data?.columns ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(860px,calc(100vh-2rem))] max-w-6xl! grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <div className="border-b px-6 pt-5 pb-4">
          <DialogTitle className="text-base">
            {isNew ? "Neuer Chart" : "Chart bearbeiten"}
          </DialogTitle>
          <nav aria-label="Chart-Schritte" className="mt-3 grid grid-cols-3 gap-2">
            {STEPS.map((s) => {
              const reachable = s.id === 1 || stepReady[s.id - 1];
              const done = s.id < step && stepReady[s.id];
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={!reachable}
                  aria-current={step === s.id ? "step" : undefined}
                  onClick={() => setStep(s.id)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                    step === s.id
                      ? "border-primary bg-primary/5"
                      : reachable
                        ? "hover:bg-muted"
                        : "opacity-45",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                      step === s.id && "border-primary bg-primary text-primary-foreground",
                    )}
                  >
                    {done ? <CheckIcon className="size-3.5" /> : <s.icon className="size-3.5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold">
                      {s.id}. {s.label}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {s.question}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>
        </div>
        <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
          <div className="min-h-0 overflow-y-auto p-6">
            {step === 1 && <ChartDataStep dataset={dataset} onChange={patchDataset} />}
            {step === 2 && (
              <ChartQuestionStep
                dataset={dataset}
                onChange={patchDataset}
                resultColumns={resultColumns}
              />
            )}
            {step === 3 && shape && (
              <ChartStyleStep widget={widget} shape={shape} onChange={patchWidget} />
            )}
          </div>
          <aside className="hidden min-h-0 flex-col border-l bg-muted/20 lg:flex">
            <div className="border-b px-4 py-3">
              <h2 className="text-xs font-semibold">So sieht dein Chart aus</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Die Vorschau zeigt echte Daten und folgt jeder deiner Entscheidungen.
              </p>
            </div>
            <div className="min-h-0 flex-1 p-4">
              <div className="h-full min-h-56">
                <WidgetCardInner
                  widget={widget}
                  dataset={dataset}
                  refreshSec={0}
                  locked
                  onChange={noop}
                  onRemove={noop}
                />
              </div>
            </div>
            <div className="max-h-44 shrink-0 overflow-hidden border-t">
              <ChartPreviewTable query={preview} />
            </div>
          </aside>
        </div>
        <div className="flex items-center gap-2 border-t px-6 py-3">
          {!isNew && onDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                if (window.confirm("Diesen Chart wirklich löschen?")) {
                  onDelete();
                  onOpenChange(false);
                }
              }}
            >
              Löschen
            </Button>
          )}
          {!isNew && onDuplicate && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onDuplicate();
                onOpenChange(false);
              }}
            >
              Duplizieren
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!canFinish}
              onClick={() => {
                useDashboardWorkspaceStore
                  .getState()
                  .saveChart(makeChartFile(widget, dataset, widget.title || dataset.name));
                toast.success("Chart in deiner Sammlung gespeichert");
              }}
            >
              <BookmarkIcon /> In Sammlung speichern
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            {step > 1 && (
              <Button variant="outline" size="sm" onClick={() => setStep(step - 1)}>
                ← Zurück
              </Button>
            )}
            {step < 3 ? (
              <Button size="sm" disabled={!stepReady[step]} onClick={() => setStep(step + 1)}>
                Weiter →
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={!canFinish}
                onClick={() => {
                  onSave(state);
                  onOpenChange(false);
                }}
              >
                Fertig
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
