import { PlusIcon } from "lucide-react";
import type { NotebookCellType } from "@/lib/notebook";
import { cn } from "@/lib/utils";

const OPTIONS: Array<[NotebookCellType, string]> = [
  ["sql", "SQL"],
  ["markdown", "Text"],
  ["variables", "Variablen"],
];

export function NotebookAddCell({
  onAdd,
  compact,
}: {
  onAdd: (type: NotebookCellType) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "group/add relative ml-12 flex h-6 items-center justify-center",
        compact && "opacity-0 transition-opacity focus-within:opacity-100 hover:opacity-100",
      )}
    >
      <span className="absolute inset-x-0 top-1/2 h-px bg-primary/40" />
      <div className="relative flex items-center rounded-full border border-primary/40 bg-background px-2 text-xs">
        <PlusIcon className="mr-0.5 size-3 text-primary" />
        {OPTIONS.map(([type, label], index) => (
          <span key={type} className="flex items-center">
            {index > 0 && <span className="text-muted-foreground">·</span>}
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onAdd(type)}
            >
              {label}
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
