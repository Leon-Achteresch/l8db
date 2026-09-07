import { PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type BuilderOrder,
  type ColumnOption,
  columnOptionValue,
  parseColumnOptionValue,
  type SortDirection,
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
  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium">Sortierung</span>
        <Button size="sm" variant="ghost" onClick={onAdd} disabled={options.length === 0}>
          <PlusIcon />
          Sortierung
        </Button>
      </div>
      <div className="space-y-2 p-3">
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Sortierung definiert.</p>
        ) : (
          orders.map((order) => (
            <div key={order.id} className="flex items-center gap-2">
              <Select
                value={columnOptionValue(order.source, order.column)}
                onValueChange={(value) => onChange(order.id, parseColumnOptionValue(value))}
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Spalte" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={order.direction}
                onValueChange={(value) => onChange(order.id, { direction: value as SortDirection })}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ASC">aufsteigend</SelectItem>
                  <SelectItem value="DESC">absteigend</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Sortierung entfernen"
                onClick={() => onRemove(order.id)}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
