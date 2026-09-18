import {
  Code2Icon,
  FilterIcon,
  PlayIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { SqlEditor } from "@/features/table/sql-editor";
import { FilterConditionsEditor } from "./filter-conditions-editor";
import type { FilterMode } from "./types";
import type { useTableSearch } from "./use-table-search";

type EntityFilterPanelProps = Pick<
  ReturnType<typeof useTableSearch>,
  | "selectedEntity"
  | "kind"
  | "whereClause"
  | "filterMode"
  | "switchFilterMode"
  | "conditions"
  | "combinator"
  | "setCombinator"
  | "selectedColumns"
  | "compiledSimple"
  | "updateCondition"
  | "addCondition"
  | "removeCondition"
  | "sql"
  | "setSql"
  | "resetFilter"
  | "handleOpen"
>;

export function EntityFilterPanel({
  selectedEntity,
  kind,
  whereClause,
  filterMode,
  switchFilterMode,
  conditions,
  combinator,
  setCombinator,
  selectedColumns,
  compiledSimple,
  updateCondition,
  addCondition,
  removeCondition,
  sql,
  setSql,
  resetFilter,
  handleOpen,
}: EntityFilterPanelProps) {
  return (
    <div className="flex min-h-0 w-1/2 flex-col">
      {selectedEntity ? (
        <>
          <div className="flex items-center gap-2 border-b px-3 py-1.5">
            <FilterIcon className="size-3.5 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">
              {selectedEntity.name}
            </span>
            {whereClause && (
              <Badge variant="secondary" className="text-[10px]">
                {kind === "mongodb" ? "JSON" : kind === "redis" ? "MATCH" : "WHERE"}
              </Badge>
            )}
          </div>
          <div className="border-b px-3 py-2">
            <Tabs
              value={kind === "redis" ? "sql" : filterMode}
              onValueChange={(v) => switchFilterMode(v as FilterMode)}
            >
              <TabsList className="w-full">
                <TabsTrigger value="simple" className="flex-1" disabled={kind === "redis"}>
                  <SlidersHorizontalIcon className="size-3" />
                  Einfach
                </TabsTrigger>
                <TabsTrigger value="sql" className="flex-1">
                  <Code2Icon className="size-3" />
                  {kind === "mongodb"
                    ? "JSON"
                    : kind === "redis"
                      ? "MATCH"
                      : kind === "cassandra"
                        ? "CQL"
                        : "SQL"}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 p-3">
              {filterMode === "simple" && kind !== "redis" ? (
                <FilterConditionsEditor
                  kind={kind}
                  conditions={conditions}
                  combinator={combinator}
                  setCombinator={setCombinator}
                  selectedColumns={selectedColumns}
                  compiledSimple={compiledSimple}
                  updateCondition={updateCondition}
                  addCondition={addCondition}
                  removeCondition={removeCondition}
                  handleOpen={handleOpen}
                />
              ) : kind === "mongodb" || kind === "redis" ? (
                <Textarea
                  value={sql}
                  onChange={(event) => setSql(event.target.value)}
                  aria-label={kind === "mongodb" ? "MongoDB-Filter" : "Redis-Key-Pattern"}
                  placeholder={kind === "mongodb" ? '{"status": "active"}' : "user:*"}
                  className="font-mono text-xs"
                />
              ) : (
                <SqlEditor
                  value={sql}
                  onChange={setSql}
                  onSubmit={handleOpen}
                  columns={selectedColumns}
                  placeholder="z.B. status = 'active' AND id > 100"
                  className="h-32"
                />
              )}
            </div>
          </ScrollArea>

          <div className="flex items-center gap-2 border-t px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={resetFilter}
              disabled={!whereClause}
            >
              <RotateCcwIcon />
            </Button>
            <div className="flex-1" />
            <Button type="button" size="xs" onClick={handleOpen}>
              <PlayIcon />
              Offnen
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <FilterIcon className="size-8 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">Tabelle auswahlen um Filter zu setzen</p>
          <p className="text-[10px] text-muted-foreground/60">Doppelklick offnet direkt</p>
        </div>
      )}
    </div>
  );
}
