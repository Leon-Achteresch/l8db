import { XIcon } from "lucide-react";
import { IconButton } from "@/components/icon-button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AGG_LABEL, type Agg, type DatasetMetric, isNumericType } from "@/lib/dashboards";
import { fieldAggregations } from "./chart-visual-builder-model";
import { ColumnSelect } from "./dataset-column-select";
import type { DatasetColumn } from "./use-dataset-query";

export function ChartVisualMetric({
  metric,
  columns,
  removable,
  onChange,
  onRemove,
}: {
  metric: DatasetMetric;
  columns: DatasetColumn[];
  removable: boolean;
  onChange: (patch: Partial<DatasetMetric>) => void;
  onRemove: () => void;
}) {
  const field = columns.find((column) => column.ref === metric.column);
  const allowed = metric.column ? fieldAggregations(field?.type ?? "") : ["count"];
  const aggregations = allowed.includes(metric.agg) ? allowed : [metric.agg, ...allowed];
  return (
    <div className="space-y-2 rounded-lg bg-muted/40 p-2.5">
      <div className="flex items-center gap-2">
        <Select value={metric.agg} onValueChange={(agg) => onChange({ agg: agg as Agg })}>
          <SelectTrigger size="sm" className="h-8 min-w-0 flex-1 text-xs" aria-label="Berechnung">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {aggregations.map((agg) => (
              <SelectItem key={agg} value={agg}>
                {AGG_LABEL[agg as Agg]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <IconButton
          variant="ghost"
          size="icon-sm"
          aria-label={`Kennzahl ${metric.label || field?.label || "Anzahl Zeilen"} entfernen`}
          disabled={!removable}
          onClick={onRemove}
        >
          <XIcon />
        </IconButton>
      </div>
      <ColumnSelect
        value={metric.column}
        columns={columns}
        label="Feld der Kennzahl"
        allowNone={metric.agg === "count" ? "Alle Zeilen" : undefined}
        filter={
          metric.agg === "sum" || metric.agg === "avg"
            ? (column) => isNumericType(column.type)
            : undefined
        }
        onChange={(column) => onChange({ column })}
      />
      <Input
        aria-label={`Name der Kennzahl ${field?.label || "Anzahl Zeilen"}`}
        value={metric.label}
        onChange={(event) => onChange({ label: event.target.value })}
        placeholder="Name im Chart (optional)"
        className="h-7 border-transparent bg-transparent text-[11px] shadow-none hover:border-input focus-visible:border-input"
      />
    </div>
  );
}
