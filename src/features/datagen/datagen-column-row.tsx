import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { defaultGenerator, GENERATOR_KINDS, GENERATOR_LABELS } from "@/lib/datagen";
import type { DatagenColumn, DatagenGeneratorKind } from "@/lib/db";
import { DatagenGeneratorParams } from "./datagen-generator-params";

interface Props {
  column: DatagenColumn;
  onChange: (patch: Partial<DatagenColumn>) => void;
}

export function DatagenColumnRow({ column, onChange }: Props) {
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_11rem_minmax(0,1fr)_5.5rem] items-center gap-2 py-1">
      <div className="min-w-0">
        <p className="truncate font-mono text-xs font-medium" title={column.name}>
          {column.name}
        </p>
        <p className="truncate text-[10px] text-muted-foreground" title={column.note ?? undefined}>
          {column.dataType}
          {column.nullable ? "" : " · NOT NULL"}
          {column.note ? ` · ${column.note}` : ""}
        </p>
      </div>
      <Select
        value={column.generator.kind}
        onValueChange={(value) =>
          onChange({ generator: defaultGenerator(value as DatagenGeneratorKind, column) })
        }
      >
        <SelectTrigger size="sm" className="w-full" aria-label={`Generator ${column.name}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" className="max-h-72">
          {GENERATOR_KINDS.filter(
            (kind) => kind !== "reference" || column.generator.kind === "reference",
          ).map((kind) => (
            <SelectItem key={kind} value={kind}>
              {GENERATOR_LABELS[kind]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex min-w-0 items-center gap-1.5">
        <DatagenGeneratorParams
          name={column.name}
          generator={column.generator}
          onChange={(generator) => onChange({ generator })}
        />
      </div>
      <div className="flex items-center gap-1" title="Anteil der Zeilen, die NULL erhalten">
        <Input
          className="h-7 text-xs"
          type="number"
          min={0}
          max={100}
          disabled={!column.nullable || column.generator.kind === "skip"}
          aria-label={`NULL-Anteil ${column.name}`}
          title="NULL-Anteil in %"
          value={Math.round(column.nullRatio * 100)}
          onChange={(event) =>
            onChange({
              nullRatio: Math.min(100, Math.max(0, Number(event.target.value) || 0)) / 100,
            })
          }
        />
        <span className="text-[10px] text-muted-foreground">%</span>
      </div>
    </div>
  );
}
