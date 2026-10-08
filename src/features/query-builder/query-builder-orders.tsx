import { ArrowDownWideNarrowIcon, ArrowUpNarrowWideIcon, XIcon } from "lucide-react";
import { IconButton } from "@/components/icon-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QueryBuilderSection } from "@/features/query-builder/query-builder-section";
import { useListAnimation } from "@/lib/hooks/use-list-animation";
import {
  type BuilderOrder,
  type ColumnOption,
  columnOptionValue,
  parseColumnOptionValue,
} from "@/lib/query-builder";

interface QueryBuilderOrdersProps {
  orders: BuilderOrder[];
  options: ColumnOption[];
  onChange: (id: string, patch: Partial<BuilderOrder>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}

export function QueryBuilderOrders({
  orders,
  options,
  onChange,
  onAdd,
  onRemove,
}: QueryBuilderOrdersProps) {
  const listRef = useListAnimation<HTMLDivElement>();
  return (
    <QueryBuilderSection
      title="Sortierung"
      count={orders.length}
      addLabel="Sortierung hinzufügen"
      addDisabled={options.length === 0}
      onAdd={onAdd}
    >
      <div ref={listRef} className="space-y-1.5">
        {orders.map((order) => (
          <div key={order.id} className="flex items-center gap-1">
            <Select
              value={columnOptionValue(order.source, order.column)}
              onValueChange={(value) => onChange(order.id, parseColumnOptionValue(value))}
            >
              <SelectTrigger
                size="sm"
                className="h-7 min-w-0 flex-1 font-mono text-xs"
                aria-label="Spalte"
              >
                <SelectValue placeholder="Spalte" />
              </SelectTrigger>
              <SelectContent searchable>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <IconButton
              size="icon-xs"
              variant="outline"
              className="size-7"
              aria-label={order.direction === "ASC" ? "Aufsteigend" : "Absteigend"}
              onClick={() =>
                onChange(order.id, { direction: order.direction === "ASC" ? "DESC" : "ASC" })
              }
            >
              {order.direction === "ASC" ? <ArrowUpNarrowWideIcon /> : <ArrowDownWideNarrowIcon />}
            </IconButton>
            <IconButton
              size="icon-xs"
              variant="ghost"
              className="text-muted-foreground"
              aria-label="Sortierung entfernen"
              onClick={() => onRemove(order.id)}
            >
              <XIcon />
            </IconButton>
          </div>
        ))}
      </div>
    </QueryBuilderSection>
  );
}
