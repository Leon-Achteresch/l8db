import { ArrowDownIcon, ArrowUpIcon, Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "@/components/icon-button";
import type { NotebookCellType } from "@/lib/notebook";
import { cn } from "@/lib/utils";
import { NotebookAddCell } from "./notebook-add-cell";

const TYPE_LABEL: Record<NotebookCellType, string> = {
  markdown: "Text",
  sql: "SQL",
  variables: "Variablen",
};

export function NotebookCellFrame({
  type,
  first,
  last,
  onMove,
  onRemove,
  onAdd,
  children,
}: {
  type: NotebookCellType;
  first: boolean;
  last: boolean;
  onMove: (delta: number) => void;
  onRemove: () => void;
  onAdd: (type: NotebookCellType) => void;
  children: ReactNode;
}) {
  return (
    <section className="group/cell flex flex-col gap-2">
      <div>
        <div className="mb-1 flex items-center gap-1 opacity-60 transition-opacity group-hover/cell:opacity-100">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {TYPE_LABEL[type]}
          </span>
          <div className="ml-auto flex items-center">
            <IconButton
              variant="ghost"
              size="icon-xs"
              aria-label="Nach oben"
              disabled={first}
              onClick={() => onMove(-1)}
            >
              <ArrowUpIcon />
            </IconButton>
            <IconButton
              variant="ghost"
              size="icon-xs"
              aria-label="Nach unten"
              disabled={last}
              onClick={() => onMove(1)}
            >
              <ArrowDownIcon />
            </IconButton>
            <IconButton
              variant="ghost"
              size="icon-xs"
              aria-label="Zelle löschen"
              onClick={onRemove}
            >
              <Trash2Icon />
            </IconButton>
          </div>
        </div>
        <div className={cn(type !== "markdown" && "rounded-md border bg-card/90 p-3 shadow-xs")}>
          {children}
        </div>
      </div>
      <NotebookAddCell onAdd={onAdd} compact />
    </section>
  );
}
