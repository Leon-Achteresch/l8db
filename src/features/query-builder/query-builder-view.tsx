import { useNavigate } from "@tanstack/react-router";
import { PlayIcon, RotateCcwIcon, TableIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QueryBuilderColumns } from "@/features/query-builder/query-builder-columns";
import { QueryBuilderConditions } from "@/features/query-builder/query-builder-conditions";
import { QueryBuilderJoin } from "@/features/query-builder/query-builder-join";
import { QueryBuilderOrders } from "@/features/query-builder/query-builder-orders";
import { useActiveConnection } from "@/lib/connections";
import { supports } from "@/lib/providers";
import { isBuilderReady } from "@/lib/query-builder";
import { useTableTabs } from "@/lib/table-tabs";
import { useQueryBuilderState } from "./query-builder-view/use-query-builder-state";

export function QueryBuilderView() {
  const connection = useActiveConnection();
  const navigate = useNavigate();
  const openQueryTabWithSql = useTableTabs((state) => state.openQueryTabWithSql);
  const hasForeignKeys = supports(connection, "foreign_keys");
  const {
    state,
    setState,
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="query-builder-table">Tabelle</Label>
          <Select value={state.table} onValueChange={selectTable}>
            <SelectTrigger id="query-builder-table" className="w-72">
              <SelectValue placeholder="Tabelle wählen" />
            </SelectTrigger>
            <SelectContent searchable>
              {(tablesQuery.data ?? []).map((table) => (
                <SelectItem key={`${table.schema}.${table.name}`} value={table.name}>
                  {table.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="query-builder-limit">LIMIT</Label>
          <Input
            id="query-builder-limit"
            className="w-32"
            inputMode="numeric"
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
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={reset}>
            <RotateCcwIcon />
            Zurücksetzen
          </Button>
          <Button onClick={openInQueryTab} disabled={!isBuilderReady(state)}>
            <PlayIcon />
            In Query-Tab öffnen
          </Button>
        </div>
      </div>

      {!isBuilderReady(state) ? (
        <div className="flex flex-1 items-center justify-center gap-2 rounded-md border border-dashed p-8 text-sm text-muted-foreground">
          <TableIcon className="size-4" />
          Wähle eine Tabelle, um eine SELECT-Abfrage zusammenzustellen.
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <QueryBuilderColumns
              title={`Spalten: ${state.table}`}
              columns={baseColumns}
              selected={state.columns}
              loading={baseColumnsQuery.isLoading}
              onToggle={toggleBaseColumn}
              onSelectAll={() =>
                setState((current) => ({ ...current, columns: baseColumns.map((c) => c.name) }))
              }
              onSelectNone={() => setState((current) => ({ ...current, columns: [] }))}
            />
            {hasForeignKeys ? (
              <QueryBuilderJoin
                relations={relations}
                selectedKey={selectedJoinKey}
                joinType={state.join?.type ?? joinTypeDraft}
                loading={foreignKeysQuery.isLoading}
                onSelect={selectJoin}
                onJoinTypeChange={changeJoinType}
              >
                {state.join ? (
                  <QueryBuilderColumns
                    title={`Spalten: ${state.join.table}`}
                    columns={joinColumns}
                    selected={state.join.columns}
                    loading={joinColumnsQuery.isLoading}
                    onToggle={toggleJoinColumn}
                    onSelectAll={() =>
                      setState((current) =>
                        current.join
                          ? {
                              ...current,
                              join: { ...current.join, columns: joinColumns.map((c) => c.name) },
                            }
                          : current,
                      )
                    }
                    onSelectNone={() =>
                      setState((current) =>
                        current.join
                          ? { ...current, join: { ...current.join, columns: [] } }
                          : current,
                      )
                    }
                  />
                ) : null}
              </QueryBuilderJoin>
            ) : null}
          </div>

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

          <div className="rounded-md border">
            <div className="border-b px-3 py-2 text-sm font-medium">SQL-Vorschau</div>
            <pre className="overflow-auto p-3 font-mono text-xs whitespace-pre-wrap">{sql}</pre>
          </div>
        </>
      )}
    </div>
  );
}
