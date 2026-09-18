import { PlusIcon, XIcon } from "lucide-react";
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
import { AGG_LABEL, type Agg, createId, isNumericType, type SimpleDataset } from "@/lib/dashboards";
import { ColumnSelect } from "../dataset-column-select";
import { AGG_SIMPLE, type ColumnOpt } from "./constants";

export function ChartMetricsSection({
  s,
  columns,
  typeOf,
  patchSimple,
}: {
  s: SimpleDataset;
  columns: ColumnOpt[];
  typeOf: (ref: string | null | undefined) => string;
  patchSimple: (patch: Partial<SimpleDataset>) => void;
}) {
  return (
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
              onClick={() => patchSimple({ metrics: s.metrics.filter((x) => x.id !== metric.id) })}
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
  );
}
