import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface ColumnOpt {
  ref: string;
  label: string;
  type: string;
}

const NONE = "__none__";

export function ColumnSelect({
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
