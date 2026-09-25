import { BracesIcon, CodeIcon, TextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NotebookCellType } from "@/lib/notebook";
import { cn } from "@/lib/utils";

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
        "flex justify-center gap-1 py-1",
        compact && "opacity-0 transition-opacity focus-within:opacity-100 hover:opacity-100",
      )}
    >
      <Button
        size="sm"
        variant="ghost"
        className="h-6 gap-1 text-[11px]"
        onClick={() => onAdd("sql")}
      >
        <CodeIcon className="size-3" /> SQL
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 gap-1 text-[11px]"
        onClick={() => onAdd("markdown")}
      >
        <TextIcon className="size-3" /> Text
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 gap-1 text-[11px]"
        onClick={() => onAdd("variables")}
      >
        <BracesIcon className="size-3" /> Variablen
      </Button>
    </div>
  );
}
