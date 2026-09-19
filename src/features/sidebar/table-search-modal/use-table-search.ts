import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useActiveConnection } from "@/lib/connections";
import { useColumnsQuery, useTablesQuery, useViewsQuery } from "@/lib/queries";
import { compileSearchPatterns } from "@/lib/regex-search";
import { useSettingsStore } from "@/lib/settings";
import { compileFilterConditions } from "@/lib/sql-filter";
import { useTableTabs } from "@/lib/table-tabs";
import { emptyCondition, parsePatterns } from "./lib";
import type { Combinator, Condition, FilterMode, MatchedEntity, SearchMode } from "./types";

export function useTableSearch(open: boolean, onOpenChange: (open: boolean) => void) {
  const navigate = useNavigate();
  const openTab = useTableTabs((state) => state.openTab);

  const [searchMode, setSearchMode] = useState<SearchMode>("objects");
  const [nameQuery, setNameQuery] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [regexError, setRegexError] = useState<string | null>(null);

  const [filterMode, setFilterMode] = useState<FilterMode>("simple");
  const [conditions, setConditions] = useState<Condition[]>([emptyCondition()]);
  const [combinator, setCombinator] = useState<Combinator>("AND");
  const [sql, setSql] = useState("");

  const [selectedEntity, setSelectedEntity] = useState<MatchedEntity | null>(null);
  const searchIncludeColumns = useSettingsStore((state) => state.searchIncludeColumns);
  const setSearchIncludeColumns = useSettingsStore((state) => state.setSearchIncludeColumns);

  const { data: tables } = useTablesQuery();
  const { data: views } = useViewsQuery();
  const { data: tableColumns } = useColumnsQuery("BASE TABLE", searchIncludeColumns);
  const { data: viewColumns } = useColumnsQuery("VIEW", searchIncludeColumns);

  useEffect(() => {
    if (!open) return;
    setSearchMode("objects");
    setNameQuery("");
    setUseRegex(false);
    setRegexError(null);
    setFilterMode("simple");
    setConditions([emptyCondition()]);
    setCombinator("AND");
    setSql("");
    setSelectedEntity(null);
  }, [open]);

  useEffect(() => {
    if (!useRegex || !nameQuery.trim()) {
      setRegexError(null);
      return;
    }
    const compiled = compileSearchPatterns(nameQuery, { global: false });
    if (!compiled.ok) {
      setRegexError(compiled.error.message);
      return;
    }
    setRegexError(null);
  }, [nameQuery, useRegex]);

  const columnsByTable = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const col of tableColumns ?? []) {
      const key = `table:${col.schema}.${col.table}`;
      const arr = map.get(key);
      if (arr) arr.push(col.name);
      else map.set(key, [col.name]);
    }
    for (const col of viewColumns ?? []) {
      const key = `view:${col.schema}.${col.table}`;
      const arr = map.get(key);
      if (arr) arr.push(col.name);
      else map.set(key, [col.name]);
    }
    return map;
  }, [tableColumns, viewColumns]);

  const filteredEntities = useMemo<MatchedEntity[]>(() => {
    const matchers = parsePatterns(nameQuery, useRegex);
    const allEntities: { schema: string; name: string; type: "table" | "view" }[] = [
      ...(tables ?? []).map((t) => ({ ...t, type: "table" as const })),
      ...(views ?? []).map((v) => ({ ...v, type: "view" as const })),
    ];
    if (matchers.length === 0) {
      return allEntities.map((e) => ({ ...e, matchingColumns: [] }));
    }
    const results: MatchedEntity[] = [];
    for (const entity of allEntities) {
      const nameMatches = matchers.some((m) => m(entity.name));
      const fullMatches = matchers.some((m) => m(`${entity.schema}.${entity.name}`));
      if (!searchIncludeColumns) {
        if (nameMatches || fullMatches) {
          results.push({ ...entity, matchingColumns: [] });
        }
        continue;
      }
      const key = `${entity.type}:${entity.schema}.${entity.name}`;
      const cols = columnsByTable.get(key) ?? [];
      const matchingColumns = cols.filter((c) => matchers.some((m) => m(c)));
      if (nameMatches || fullMatches || matchingColumns.length > 0) {
        results.push({ ...entity, matchingColumns });
      }
    }
    return results;
  }, [tables, views, nameQuery, useRegex, columnsByTable, searchIncludeColumns]);

  const selectedColumns = useMemo(() => {
    if (!selectedEntity) return [];
    const key = `${selectedEntity.type}:${selectedEntity.schema}.${selectedEntity.name}`;
    return columnsByTable.get(key) ?? [];
  }, [selectedEntity, columnsByTable]);

  const selectedColumnDetails = useMemo(() => {
    if (!selectedEntity) return [];
    return (
      (selectedEntity.type === "table" ? tableColumns : viewColumns)?.filter(
        (column) => column.schema === selectedEntity.schema && column.table === selectedEntity.name,
      ) ?? []
    );
  }, [selectedEntity, tableColumns, viewColumns]);

  const kind = useActiveConnection()?.kind;
  const compiledSimple = useMemo(
    () => compileFilterConditions(conditions, combinator, kind, selectedColumnDetails),
    [conditions, combinator, kind, selectedColumnDetails],
  );
  const whereClause = kind === "redis" || filterMode === "sql" ? sql.trim() : compiledSimple;
  const whereIsRaw = kind === "redis" || filterMode === "sql";

  const updateCondition = (id: string, patch: Partial<Condition>) => {
    setConditions((cur) => cur.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const addCondition = () => {
    setConditions((cur) => [...cur, emptyCondition(selectedColumns[0] ?? "")]);
  };

  const removeCondition = (id: string) => {
    setConditions((cur) => {
      const next = cur.filter((c) => c.id !== id);
      return next.length > 0 ? next : [emptyCondition()];
    });
  };

  const switchFilterMode = (next: FilterMode) => {
    if (next === "sql" && sql.trim() === "" && compiledSimple !== "") {
      setSql(compiledSimple);
    }
    setFilterMode(next);
  };

  const resetFilter = () => {
    setConditions([emptyCondition()]);
    setCombinator("AND");
    setSql("");
  };

  const handleSelectEntity = useCallback((entity: MatchedEntity) => {
    setSelectedEntity(entity);
    setConditions([emptyCondition()]);
    setCombinator("AND");
    setSql("");
  }, []);

  const handleOpen = useCallback(() => {
    if (!selectedEntity) return;
    openTab({
      schema: selectedEntity.schema,
      table: selectedEntity.name,
      entityType: selectedEntity.type,
    });
    onOpenChange(false);
    void navigate({
      to: "/tables/$schema/$table",
      params: { schema: selectedEntity.schema, table: selectedEntity.name },
      search: {
        type: selectedEntity.type,
        ...(whereClause ? { fkFilter: whereClause } : {}),
        ...(whereClause && whereIsRaw ? { fkRaw: true } : {}),
      },
    });
  }, [selectedEntity, whereClause, whereIsRaw, openTab, onOpenChange, navigate]);

  const handleOpenDirect = useCallback(
    (entity: MatchedEntity) => {
      openTab({
        schema: entity.schema,
        table: entity.name,
        entityType: entity.type,
      });
      onOpenChange(false);
      void navigate({
        to: "/tables/$schema/$table",
        params: { schema: entity.schema, table: entity.name },
        search: { type: entity.type },
      });
    },
    [openTab, onOpenChange, navigate],
  );

  return {
    searchMode,
    setSearchMode,
    nameQuery,
    setNameQuery,
    useRegex,
    setUseRegex,
    regexError,
    filterMode,
    conditions,
    combinator,
    setCombinator,
    sql,
    setSql,
    selectedEntity,
    searchIncludeColumns,
    setSearchIncludeColumns,
    filteredEntities,
    selectedColumns,
    kind,
    compiledSimple,
    whereClause,
    updateCondition,
    addCondition,
    removeCondition,
    switchFilterMode,
    resetFilter,
    handleSelectEntity,
    handleOpen,
    handleOpenDirect,
  };
}
