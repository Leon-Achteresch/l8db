import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  EllipsisIcon,
  ListEndIcon,
  PlayIcon,
  SeparatorHorizontalIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "@/components/icon-button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NotebookCellType } from "@/lib/notebook";
import { cn } from "@/lib/utils";
import { NotebookAddCell } from "./notebook-add-cell";

export function NotebookCellFrame({
  id,
  type,
  counter,
  first,
  last,
  pageBreak,
  divider = true,
  run,
  onTogglePageBreak,
  onMove,
  onDuplicate,
  onRemove,
  onAdd,
  children,
}: {
  id: string;
  type: NotebookCellType;
  counter: string | null;
  first: boolean;
  last: boolean;
  pageBreak: boolean;
  divider?: boolean;
  run?: { running: boolean; onRun: () => void; onRunFrom: () => void; onCancel: () => void };
  onTogglePageBreak: () => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onAdd: (type: NotebookCellType) => void;
  children: ReactNode;
}) {
  return (
    <section data-cell-id={id} data-page-start={pageBreak && !first ? "" : undefined}>
      {divider && pageBreak && !first && (
        <div className="mb-3 ml-12 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="h-px flex-1 border-t border-dashed" />
          Neue Seite
          <span className="h-px flex-1 border-t border-dashed" />
        </div>
      )}
      <div className="group/cell grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2">
        <span
          className={cn(
            "pt-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground",
            counter && counter !== "[ ]" && "text-primary",
          )}
        >
          {counter}
        </span>
        <div className="relative">
          <div className="absolute -top-3.5 right-3 z-10 flex items-center rounded-md border bg-popover p-0.5 opacity-0 shadow-sm transition-opacity group-focus-within/cell:opacity-100 group-hover/cell:opacity-100">
            {run &&
              (run.running ? (
                <IconButton
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Abbrechen"
                  onClick={run.onCancel}
                >
                  <SquareIcon />
                </IconButton>
              ) : (
                <IconButton
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Zelle ausführen (⌘↵)"
                  onClick={run.onRun}
                >
                  <PlayIcon />
                </IconButton>
              ))}
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
              aria-label="Duplizieren"
              onClick={onDuplicate}
            >
              <CopyIcon />
            </IconButton>
            <IconButton
              variant="ghost"
              size="icon-xs"
              aria-label="Zelle löschen"
              onClick={onRemove}
            >
              <Trash2Icon />
            </IconButton>
            <span className="mx-0.5 h-4 w-px bg-border" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton variant="ghost" size="icon-xs" aria-label="Weitere Zellaktionen">
                  <EllipsisIcon />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {run && (
                  <DropdownMenuItem disabled={run.running} onSelect={run.onRunFrom}>
                    <ListEndIcon /> Ab hier ausführen
                  </DropdownMenuItem>
                )}
                <DropdownMenuCheckboxItem
                  checked={pageBreak}
                  disabled={first}
                  onCheckedChange={onTogglePageBreak}
                >
                  <SeparatorHorizontalIcon /> Auf neuer Seite beginnen
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div
            className={cn(
              type === "markdown"
                ? "rounded-lg px-1"
                : "overflow-hidden rounded-lg border bg-card shadow-xs",
            )}
          >
            {children}
          </div>
        </div>
      </div>
      {!last && <NotebookAddCell onAdd={onAdd} compact />}
    </section>
  );
}
