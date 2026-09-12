import { CheckIcon, PlayIcon, WandSparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActiveConnection } from "@/lib/connections";
import type { Dataset } from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import { adoptSimple } from "./dataset-adopt";
import { MappingSelect } from "./dataset-mapping-select";
import { SqlEditor } from "./sql-editor";

export function ExpertBuilder({
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
