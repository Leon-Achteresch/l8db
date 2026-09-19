import { Input } from "@/components/ui/input";
import { isDateType } from "@/lib/dashboards";
import type { ChartFilterField } from "../chart-filter-editor";

export function ChartFilterRangeInputs({
  field,
  lower,
  upper,
  setLower,
  setUpper,
  boundsValid,
}: {
  field: ChartFilterField;
  lower: string;
  upper: string;
  setLower: (value: string) => void;
  setUpper: (value: string) => void;
  boundsValid: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <label htmlFor="range-from" className="space-y-1 text-xs">
          <span>Von (einschließlich)</span>
          <Input
            id="range-from"
            aria-label="Filter von"
            type={isDateType(field.dataType) ? "date" : "number"}
            value={lower}
            onChange={(e) => setLower(e.target.value)}
            placeholder="Keine Untergrenze"
          />
        </label>
        <label htmlFor="range-to" className="space-y-1 text-xs">
          <span>Bis (einschließlich)</span>
          <Input
            id="range-to"
            aria-label="Filter bis"
            type={isDateType(field.dataType) ? "date" : "number"}
            value={upper}
            onChange={(e) => setUpper(e.target.value)}
            placeholder="Keine Obergrenze"
          />
        </label>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Du kannst eine Grenze frei lassen. Gefiltert werden die einzelnen Datensätze, bevor ihre
        Werte zusammengefasst werden.
      </p>
      {!boundsValid && (
        <p role="alert" className="text-xs text-destructive">
          Die Untergrenze muss kleiner oder gleich der Obergrenze sein.
        </p>
      )}
    </div>
  );
}
