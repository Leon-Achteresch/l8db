import { useNavigate } from "@tanstack/react-router";
import { PlayIcon, RotateCcwIcon, TableIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
import { QueryBuilderJoin, relationKey } from "@/features/query-builder/query-builder-join";
import { QueryBuilderOrders } from "@/features/query-builder/query-builder-orders";
import { useActiveConnection } from "@/lib/connections";
import { useActiveSchema } from "@/lib/db-selection";
import { supports } from "@/lib/providers";
import { useDetailedColumnsQuery, useForeignKeysQuery, useTablesQuery } from "@/lib/queries";
import {
  type BuilderCondition,
  type BuilderOrder,
  buildSelectSql,
  type ColumnOption,
  columnOptionValue,
  emptyBuilderState,
  isBuilderReady,
  type JoinType,
  type QueryBuilderState,
  type QuerySource,
} from "@/lib/query-builder";
import { useTableTabs } from "@/lib/table-tabs";

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

export function QueryBuilderView() {
  const connection = useActiveConnection();
  const schema = useActiveSchema();
  const navigate = useNavigate();
  const openQueryTabWithSql = useTableTabs((state) => state.openQueryTabWithSql);
  const hasForeignKeys = supports(connection, "foreign_keys");

  const [state, setState] = useState<QueryBuilderState>(() =>
    emptyBuilderState(connection?.kind ?? null),
  );
  const [joinTypeDraft, setJoinTypeDraft] = useState<JoinType>("INNER");

  const tablesQuery = useTablesQuery();
  const baseColumnsQuery = useDetailedColumnsQuery(state.schema, state.table);
  const foreignKeysQuery = useForeignKeysQuery(state.schema, state.table);
  const joinColumnsQuery = useDetailedColumnsQuery(
    state.join?.schema ?? "",
    state.join?.table ?? "",
  );

  useEffect(() => {
    setState(emptyBuilderState(connection?.kind ?? null));
  }, [connection?.kind]);

  const relations = useMemo(
    () =>
      (foreignKeysQuery.data ?? []).filter(
        (fk) => fk.from_table === state.table && fk.from_schema === state.schema,
      ),
    [foreignKeysQuery.data, state.schema, state.table],
  );

  const baseColumns = useMemo(
    () =>
      (baseColumnsQuery.data ?? []).map((column) => ({
        name: column.name,
        dataType: column.data_type,
      })),
    [baseColumnsQuery.data],
  );

  const joinColumns = useMemo(
    () =>
      (joinColumnsQuery.data ?? []).map((column) => ({
        name: column.name,
        dataType: column.data_type,
      })),
    [joinColumnsQuery.data],
  );

  const columnOptions = useMemo<ColumnOption[]>(() => {
    const options: ColumnOption[] = baseColumns.map((column) => ({
      value: columnOptionValue("base", column.name),
      label: `${state.table}.${column.name}`,
      source: "base" as QuerySource,
      column: column.name,
    }));
    if (state.join) {
      for (const column of joinColumns) {
        options.push({
          value: columnOptionValue("join", column.name),
          label: `${state.join.table}.${column.name}`,
          source: "join",
          column: column.name,
        });
      }
    }
    return options;
  }, [baseColumns, joinColumns, state.join, state.table]);

  const selectedJoinKey = useMemo(() => {
    const join = state.join;
    if (!join) return null;
    const relation = relations.find(
      (fk) =>
        fk.constraint_name === join.constraintName &&
        fk.from_column === join.fromColumn &&
        fk.to_column === join.toColumn,
    );
    return relation ? relationKey(relation) : null;
  }, [relations, state.join]);

  const sql = useMemo(() => buildSelectSql(state), [state]);

  const selectTable = (name: string) => {
    setState((current) => ({
      ...emptyBuilderState(current.kind),
      schema,
      table: name,
    }));
  };

  const toggleBaseColumn = (column: string) => {
    setState((current) => ({
      ...current,
      columns: current.columns.includes(column)
        ? current.columns.filter((c) => c !== column)
        : [...current.columns, column],
    }));
  };

  const toggleJoinColumn = (column: string) => {
    setState((current) => {
      if (!current.join) return current;
      const columns = current.join.columns.includes(column)
        ? current.join.columns.filter((c) => c !== column)
        : [...current.join.columns, column];
      return { ...current, join: { ...current.join, columns } };
    });
  };

  const selectJoin = (key: string | null) => {
    setState((current) => {
      if (key === null) {
        return {
          ...current,
          join: null,
          conditions: current.conditions.filter((c) => c.source !== "join"),
          orders: current.orders.filter((o) => o.source !== "join"),
        };
      }
      const relation = relations.find((fk) => relationKey(fk) === key);
      if (!relation) return current;
      return {
        ...current,
        join: {
          constraintName: relation.constraint_name,
          type: joinTypeDraft,
          schema: relation.to_schema,
          table: relation.to_table,
          fromColumn: relation.from_column,
          toColumn: relation.to_column,
          columns: [],
        },
      };
    });
  };

  const changeJoinType = (type: JoinType) => {
    setJoinTypeDraft(type);
    setState((current) =>
      current.join ? { ...current, join: { ...current.join, type } } : current,
    );
  };

  const addCondition = () => {
    const first = columnOptions[0];
    if (!first) return;
    setState((current) => ({
      ...current,
      conditions: [
        ...current.conditions,
        {
          id: createId(),
          source: first.source,
          column: first.column,
          operator: "eq",
          value: "",
        },
      ],
    }));
  };

  const updateCondition = (id: string, patch: Partial<BuilderCondition>) => {
    setState((current) => ({
      ...current,
      conditions: current.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  };

  const removeCondition = (id: string) => {
    setState((current) => ({
      ...current,
      conditions: current.conditions.filter((c) => c.id !== id),
    }));
  };

  const addOrder = () => {
    const first = columnOptions[0];
    if (!first) return;
    setState((current) => ({
      ...current,
      orders: [
        ...current.orders,
        { id: createId(), source: first.source, column: first.column, direction: "ASC" },
      ],
    }));
  };

  const updateOrder = (id: string, patch: Partial<BuilderOrder>) => {
    setState((current) => ({
      ...current,
      orders: current.orders.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }));
  };

  const removeOrder = (id: string) => {
    setState((current) => ({ ...current, orders: current.orders.filter((o) => o.id !== id) }));
  };

  const reset = () => {
    setState(emptyBuilderState(connection?.kind ?? null));
    setJoinTypeDraft("INNER");
  };

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
            <SelectContent>
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
