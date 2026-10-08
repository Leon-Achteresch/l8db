import {
  ArrowDownUpIcon,
  EllipsisIcon,
  FunnelIcon,
  KeyRoundIcon,
  LinkIcon,
  TableIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export const NODE_WIDTH = 232;
export const NODE_HEADER = 34;
export const NODE_ROW = 26;

export interface QueryBuilderNodeColumn {
  name: string;
  dataType: string;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  filtered?: boolean;
  sorted?: boolean;
}

interface QueryBuilderNodeProps {
  table: string;
  alias: string | null;
  columns: QueryBuilderNodeColumn[];
  selected: string[];
  loading?: boolean;
  active?: boolean;
  x: number;
  y: number;
  onToggle: (column: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onRemove?: () => void;
}

export function QueryBuilderNode({
  table,
  alias,
  columns,
  selected,
  loading,
  active,
  x,
  y,
  onToggle,
  onSelectAll,
  onSelectNone,
  onRemove,
}: QueryBuilderNodeProps) {
  return (
    <div
      className={cn(
        "absolute overflow-hidden rounded-lg border bg-card text-xs shadow-sm",
        active && "border-primary/60 ring-1 ring-primary/30",
      )}
      style={{ left: x, top: y, width: NODE_WIDTH }}
    >
      <div
        className="flex items-center gap-1.5 border-b bg-muted/40 pr-1 pl-2.5"
        style={{ height: NODE_HEADER }}
      >
        <TableIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{table}</span>
        {alias && <span className="font-mono text-[11px] text-muted-foreground">{alias}</span>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="ml-auto text-muted-foreground"
              aria-label={`Aktionen für ${table}`}
            >
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onSelectAll}>Alle Spalten wählen</DropdownMenuItem>
            <DropdownMenuItem onSelect={onSelectNone}>Keine Spalte wählen</DropdownMenuItem>
            {onRemove && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                  Join entfernen
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {loading ? (
        <div className="px-2.5 text-muted-foreground" style={{ lineHeight: `${NODE_ROW}px` }}>
          Lädt…
        </div>
      ) : columns.length === 0 ? (
        <div className="px-2.5 text-muted-foreground" style={{ lineHeight: `${NODE_ROW}px` }}>
          Keine Spalten
        </div>
      ) : (
        columns.map((column) => {
          const checked = selected.includes(column.name);
          const id = `qb-${alias ?? table}-${column.name}`;
          return (
            <label
              key={column.name}
              htmlFor={id}
              className="flex cursor-pointer items-center gap-2 px-2.5 hover:bg-muted/50"
              style={{ height: NODE_ROW }}
            >
              <Checkbox
                id={id}
                className="size-3.5"
                checked={checked}
                onCheckedChange={() => onToggle(column.name)}
              />
              <span className={cn("truncate font-mono", !checked && "text-muted-foreground")}>
                {column.name}
              </span>
              {column.isPrimaryKey && (
                <KeyRoundIcon
                  className="size-3 shrink-0 text-amber-500"
                  aria-label="Primärschlüssel"
                />
              )}
              {column.isForeignKey && (
                <LinkIcon
                  className="size-3 shrink-0 text-muted-foreground"
                  aria-label="Fremdschlüssel"
                />
              )}
              {column.filtered && (
                <FunnelIcon className="size-3 shrink-0 text-primary" aria-label="Gefiltert" />
              )}
              {column.sorted && (
                <ArrowDownUpIcon className="size-3 shrink-0 text-primary" aria-label="Sortiert" />
              )}
              <span className="ml-auto shrink-0 truncate pl-2 font-mono text-[11px] text-muted-foreground">
                {column.dataType}
              </span>
            </label>
          );
        })
      )}
    </div>
  );
}
