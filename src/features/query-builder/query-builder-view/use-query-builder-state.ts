import { useEffect, useMemo, useState } from "react";
import { relationKey } from "@/features/query-builder/query-builder-join";
import type { SavedConnection } from "@/lib/connections";
import { useActiveSchema } from "@/lib/db-selection";
import { useDetailedColumnsQuery, useForeignKeysQuery, useTablesQuery } from "@/lib/queries";
import {
  type BuilderCondition,
  type BuilderOrder,
  buildSelectSql,
  type ColumnOption,
  columnOptionValue,
  emptyBuilderState,
  type JoinType,
  type QueryBuilderState,
  type QuerySource,
} from "@/lib/query-builder";

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

export function useQueryBuilderState(connection: SavedConnection | null) {
  const schema = useActiveSchema();
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
      dataType: column.dataType,
    }));
    if (state.join) {
      for (const column of joinColumns) {
        options.push({
          value: columnOptionValue("join", column.name),
          label: `${state.join.table}.${column.name}`,
          source: "join",
          column: column.name,
          dataType: column.dataType,
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
          dataType: first.dataType,
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

  return {
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
  };
}
