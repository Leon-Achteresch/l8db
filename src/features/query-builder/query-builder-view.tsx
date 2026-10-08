import { useNavigate } from "@tanstack/react-router";
import { RotateCcwIcon, TableIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { UndoRedoControls } from "@/components/undo-redo-controls";
import { QueryBuilderCanvas } from "@/features/query-builder/query-builder-canvas";
import { QueryBuilderColumns } from "@/features/query-builder/query-builder-columns";
import { QueryBuilderConditions } from "@/features/query-builder/query-builder-conditions";
import { QueryBuilderJoin } from "@/features/query-builder/query-builder-join";
import { QueryBuilderOrders } from "@/features/query-builder/query-builder-orders";
import { QueryBuilderSection } from "@/features/query-builder/query-builder-section";
import { QueryBuilderSqlPanel } from "@/features/query-builder/query-builder-sql-panel";
import { useActiveConnection } from "@/lib/connections";
import { supports } from "@/lib/providers";
import { isBuilderReady } from "@/lib/query-builder";
import { useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";
import { useQueryBuilderState } from "./query-builder-view/use-query-builder-state";

export function QueryBuilderView() {
  const connection = useActiveConnection();
  const navigate = useNavigate();
  const openQueryTabWithSql = useTableTabs((state) => state.openQueryTabWithSql);
  const hasForeignKeys = supports(connection, "foreign_keys");
  const [mode, setMode] = useState<"visual" | "sql">("visual");
  const {
    state,
    setState,
    canUndo,
    canRedo,
    undo,
    redo,
    joinTypeDraft,
    tablesQuery,
    baseColumnsQuery,
    foreignKeysQuery,
    joinColumnsQuery,
    relations,
    baseColumns,
    joinColumns,
    columnOptions,
    selectedJoinKey,
    sql,
    selectTable,
    toggleBaseColumn,
    toggleJoinColumn,
    setBaseColumns,
    setJoinColumns,
    selectJoin,
    changeJoinType,
    addCondition,
    updateCondition,
    removeCondition,
    addOrder,
    updateOrder,
    removeOrder,
    reset,
  } = useQueryBuilderState(connection);

  const ready = isBuilderReady(state);

  const openInQueryTab = () => {
    if (sql === "") return;
    const id = openQueryTabWithSql(sql, `Builder: ${state.table}`);
    navigate({ to: "/query/$id", params: { id } });
  };

  if (!connection) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Keine aktive Verbindung.
      </div>
    );
  }

  const usedColumns = (source: "base" | "join", items: { column: string; source: string }[]) =>
    new Set(items.filter((item) => item.source === source).map((item) => item.column));
  const filteredBase = usedColumns("base", state.conditions);
  const filteredJoin = usedColumns("join", state.conditions);
  const sortedBase = usedColumns("base", state.orders);
  const sortedJoin = usedColumns("join", state.orders);
  const foreignKeyColumns = new Set(relations.map((relation) => relation.from_column));
  const tableCount = ready ? (state.join ? 2 : 1) : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          spacing={0}
          value={mode}
          onValueChange={(value) => value && setMode(value as "visual" | "sql")}
          aria-label="Ansicht"
        >
          <ToggleGroupItem value="visual" className="h-7 px-2.5 text-xs">
            Visuell
          </ToggleGroupItem>
          <ToggleGroupItem value="sql" className="h-7 px-2.5 text-xs">
            SQL
          </ToggleGroupItem>
        </ToggleGroup>
        <Select value={state.table} onValueChange={selectTable}>
          <SelectTrigger size="sm" className="h-7 w-56 justify-start text-xs" aria-label="Tabelle">
            <TableIcon className="size-3.5 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-left">
              <SelectValue placeholder="Tabelle wählen" />
            </span>
          </SelectTrigger>
          <SelectContent searchable>
            {(tablesQuery.data ?? []).map((table) => (
              <SelectItem key={`${table.schema}.${table.name}`} value={table.name}>
                {table.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {ready && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {tableCount} {tableCount === 1 ? "Tabelle" : "Tabellen"}, {state.join ? 1 : 0}{" "}
            {state.join ? "Join" : "Joins"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <UndoRedoControls canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} />
          <Separator orientation="vertical" className="mx-1 h-5" />
          <Button variant="ghost" size="sm" className="h-7" onClick={reset}>
            <RotateCcwIcon />
            Zurücksetzen
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-h-0 flex-col">
          {mode === "visual" && (
            <QueryBuilderCanvas
              state={state}
              baseColumns={baseColumns.map((column) => ({
                ...column,
                isForeignKey: foreignKeyColumns.has(column.name),
                filtered: filteredBase.has(column.name),
                sorted: sortedBase.has(column.name),
              }))}
              joinColumns={joinColumns.map((column) => ({
                ...column,
                filtered: filteredJoin.has(column.name),
                sorted: sortedJoin.has(column.name),
              }))}
              baseLoading={baseColumnsQuery.isLoading}
              joinLoading={joinColumnsQuery.isLoading}
              onToggleBase={toggleBaseColumn}
              onToggleJoin={toggleJoinColumn}
              onSelectBase={setBaseColumns}
              onSelectJoin={setJoinColumns}
              onRemoveJoin={() => selectJoin(null)}
              onJoinTypeChange={changeJoinType}
            />
          )}
          <QueryBuilderSqlPanel
            sql={sql}
            ready={ready}
            onOpen={openInQueryTab}
            className={cn(mode === "visual" ? "h-[38%] min-h-40 border-t" : "flex-1")}
          />
        </div>

        <aside className="min-h-0 overflow-y-auto border-l bg-muted/20">
          <div className="flex h-10 items-center border-b px-3 text-xs font-medium">Abfrage</div>
          {hasForeignKeys && ready && (
            <QueryBuilderJoin
              relations={relations}
              selectedKey={selectedJoinKey}
              join={state.join}
              joinType={state.join?.type ?? joinTypeDraft}
              loading={foreignKeysQuery.isLoading}
              onSelect={selectJoin}
              onJoinTypeChange={changeJoinType}
            />
          )}
          <QueryBuilderColumns
            state={state}
            onRemoveBase={toggleBaseColumn}
            onRemoveJoin={toggleJoinColumn}
          />
          <QueryBuilderConditions
            conditions={state.conditions}
            options={columnOptions}
            onChange={updateCondition}
            onAdd={addCondition}
            onRemove={removeCondition}
          />
          <QueryBuilderOrders
            orders={state.orders}
            options={columnOptions}
            onChange={updateOrder}
            onAdd={addOrder}
            onRemove={removeOrder}
          />
          <QueryBuilderSection title="Limit">
            <Input
              id="query-builder-limit"
              aria-label="LIMIT"
              className="h-7 w-24 font-mono text-xs tabular-nums"
              inputMode="numeric"
              placeholder="ohne"
              value={state.limit === null ? "" : String(state.limit)}
              onChange={(event) => {
                const raw = event.target.value.trim();
                const parsed = Number.parseInt(raw, 10);
                setState((current) => ({
                  ...current,
                  limit: raw === "" || Number.isNaN(parsed) ? null : parsed,
                }));
              }}
            />
          </QueryBuilderSection>
        </aside>
      </div>
    </div>
  );
}
