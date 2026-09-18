import { ColumnsIcon, EyeIcon, TableIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { MatchedEntity } from "./types";

interface EntityResultListProps {
  filteredEntities: MatchedEntity[];
  selectedEntity: MatchedEntity | null;
  onSelect: (entity: MatchedEntity) => void;
  onOpenDirect: (entity: MatchedEntity) => void;
}

export function EntityResultList({
  filteredEntities,
  selectedEntity,
  onSelect,
  onOpenDirect,
}: EntityResultListProps) {
  const tableResults = filteredEntities.filter((e) => e.type === "table");
  const viewResults = filteredEntities.filter((e) => e.type === "view");

  return (
    <div className="flex min-h-0 w-1/2 flex-col border-r">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {filteredEntities.length} Ergebnis{filteredEntities.length !== 1 ? "se" : ""}
        </span>
        {tableResults.length > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            <TableIcon className="size-2.5" />
            {tableResults.length}
          </Badge>
        )}
        {viewResults.length > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            <EyeIcon className="size-2.5" />
            {viewResults.length}
          </Badge>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="py-1">
          {filteredEntities.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">Keine Treffer</p>
          ) : (
            filteredEntities.map((entity) => {
              const isSelected =
                selectedEntity?.schema === entity.schema &&
                selectedEntity?.name === entity.name &&
                selectedEntity?.type === entity.type;
              return (
                <div key={`${entity.type}:${entity.schema}.${entity.name}`}>
                  <button
                    type="button"
                    onClick={() => onSelect(entity)}
                    onDoubleClick={() => onOpenDirect(entity)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted/80",
                      isSelected && "bg-muted",
                    )}
                  >
                    {entity.type === "table" ? (
                      <TableIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <EyeIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {entity.schema}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{entity.name}</span>
                  </button>
                  {entity.matchingColumns.length > 0 && (
                    <div className="ml-7 border-l border-border/40 py-0.5 pl-2">
                      {entity.matchingColumns.slice(0, 3).map((col) => (
                        <div
                          key={col}
                          className="flex items-center gap-1.5 px-1 py-0.5 text-[10px] text-muted-foreground"
                        >
                          <ColumnsIcon className="size-2.5 shrink-0" />
                          <span className="truncate">{col}</span>
                        </div>
                      ))}
                      {entity.matchingColumns.length > 3 && (
                        <span className="px-1 text-[10px] text-muted-foreground/60">
                          +{entity.matchingColumns.length - 3} weitere
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
