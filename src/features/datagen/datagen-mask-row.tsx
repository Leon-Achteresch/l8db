import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DatagenColumn } from "@/lib/db";
import { type ColumnMask, DEFAULT_MASK_TEXT, MASK_MODES, type MaskMode } from "@/lib/masking";

interface Props {
  column: DatagenColumn;
  mask: ColumnMask | null;
  onColumn: (patch: Partial<DatagenColumn>) => void;
  onMask: (mask: ColumnMask | null) => void;
}

export function DatagenMaskRow({ column, mask, onColumn, onMask }: Props) {
  const skipped = column.generator.kind === "skip";
  const value = skipped ? "skip" : (mask?.mode ?? "copy");
  return (
    <div className="grid grid-cols-[minmax(0,12rem)_11rem_minmax(0,1fr)] items-center gap-2 py-1">
      <div className="min-w-0">
        <p className="truncate font-mono text-xs font-medium">{column.name}</p>
        <p className="truncate text-[10px] text-muted-foreground">
          {column.dataType}
          {column.nullable ? "" : " · NOT NULL"}
        </p>
      </div>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next === "skip") {
            onColumn({ generator: { kind: "skip" } });
            onMask(null);
            return;
          }
          if (skipped) onColumn({ generator: { kind: "null" } });
          onMask(
            next === "copy"
              ? null
              : {
                  column: column.name,
                  mode: next as MaskMode,
                  text: next === "text" ? DEFAULT_MASK_TEXT : null,
                },
          );
        }}
      >
        <SelectTrigger size="sm" className="w-full" aria-label={`Maskierung ${column.name}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="copy">Original kopieren</SelectItem>
          <SelectItem value="skip">Auslassen (Standardwert)</SelectItem>
          {MASK_MODES.map((mode) => (
            <SelectItem
              key={mode.value}
              value={mode.value}
              disabled={mode.value === "null" && !column.nullable}
            >
              {mode.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {mask?.mode === "text" ? (
        <Input
          className="h-7 text-xs"
          aria-label={`Maskentext ${column.name}`}
          value={mask.text ?? ""}
          onChange={(event) => onMask({ ...mask, text: event.target.value })}
        />
      ) : (
        <span />
      )}
    </div>
  );
}
