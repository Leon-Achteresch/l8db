import { XIcon } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ERTable } from "@/lib/db";
import {
  ER_FOCUS_DEPTHS,
  type ErFocusDepth,
  erTableKeyOf,
  parseErFocusDepth,
} from "@/lib/er-focus";

export function ErFocusPanel({
  tables,
  focusKey,
  depth,
  onFocusChange,
  onDepthChange,
  onClear,
}: {
  tables: ERTable[];
  focusKey: string | null;
  depth: ErFocusDepth;
  onFocusChange: (key: string) => void;
  onDepthChange: (depth: ErFocusDepth) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card px-3 py-2 shadow-sm">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Fokus
      </span>
      <Select value={focusKey ?? ""} onValueChange={onFocusChange}>
        <SelectTrigger size="sm" className="w-56">
          <SelectValue placeholder="Tabelle wählen…" />
        </SelectTrigger>
        <SelectContent position="popper" searchable>
          {tables.map((table) => (
            <SelectItem key={erTableKeyOf(table)} value={erTableKeyOf(table)}>
              {erTableKeyOf(table)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-1.5">
        <Select
          value={String(depth)}
          onValueChange={(value) => onDepthChange(parseErFocusDepth(value))}
        >
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {ER_FOCUS_DEPTHS.map((value) => (
              <SelectItem key={value} value={String(value)}>
                Tiefe {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={onClear}
          disabled={!focusKey}
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          title="Fokus aufheben"
        >
          <XIcon className="size-3.5" />
          Aufheben
        </button>
      </div>
    </div>
  );
}
