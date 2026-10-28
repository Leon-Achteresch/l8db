import { useEffect, useMemo, useRef, useState } from "react";
import { createId, emptyCondition } from "@/features/table/table-filter-panel/filter-conditions";
import type { Combinator, FilterMode } from "@/features/table/table-filter-panel/filter-types";
import { useActiveConnection } from "@/lib/connections";
import type { DetailedColumnInfo } from "@/lib/db";
import { useActiveCapabilities } from "@/lib/db-selection";
import type { FilterAiContext, FilterAiProposal } from "@/lib/filter-ai/types";
import { localIsoDate } from "@/lib/filter-bar-format";
import { normalizeFilterExpressionQuotes, parseFilterExpression } from "@/lib/filter-parser";
import { useTableViewState } from "@/lib/hooks/use-table-view-state";
import { activeRuleConditions } from "@/lib/row-rules";
import { compileFilterConditions, filterSupportsOr } from "@/lib/sql-filter";
import type { FilterCondition, RowRule } from "@/lib/table-view-state";

export interface FilterBarProps {
  stateKey?: string;
  columns: string[];
  columnDetails?: DetailedColumnInfo[];
  activeFilter: string;
  onApply: (where: string, isRaw: boolean) => void;
}

export function useFilterBarModel({
  stateKey,
  columns,
  columnDetails,
  activeFilter,
  onApply,
}: FilterBarProps) {
  const caps = useActiveCapabilities();
  const kind = useActiveConnection()?.kind;
  const json = caps.query_language === "json";
  const [mode, setMode] = useTableViewState(stateKey, "filterMode", "simple");
  const [stored, setStored] = useTableViewState(stateKey, "filterConditions", () => [
    emptyCondition(),
  ]);
  const [storedCombinator, setCombinator] = useTableViewState(stateKey, "filterCombinator", "AND");
  const [rules, setRules] = useTableViewState(stateKey, "rowRules", []);
  const [sql, setSql] = useTableViewState(stateKey, "filterSql", "");
  const [error, setError] = useState("");
  const orSupported = filterSupportsOr(kind);
  const sqlLabel = json ? "JSON" : kind === "cassandra" ? "CQL" : "SQL";
  const parseKind = json ? undefined : kind;
  const active = activeFilter.trim();

  const conditions = useMemo(() => activeRuleConditions(stored), [stored]);
  const compiled = useMemo(
    () => compileFilterConditions(conditions, storedCombinator, kind, columnDetails),
    [conditions, storedCombinator, kind, columnDetails],
  );
  const matches = active === compiled || (columns.length === 0 && active !== "");
  const external = mode === "simple" && active !== "" && !matches ? active : "";
  const parsedExternal = useMemo(() => {
    if (!external) return null;
    try {
      const parsed = parseFilterExpression(external, columns, parseKind);
      return {
        conditions: parsed.conditions.map((condition) => ({ ...condition, id: createId() })),
        combinator: parsed.combinator,
      };
    } catch {
      return null;
    }
  }, [external, columns, parseKind]);
  const shown = active === "" ? [] : matches ? conditions : (parsedExternal?.conditions ?? []);
  const combinator: Combinator = parsedExternal?.combinator ?? storedCombinator;

  const previousActive = useRef(active);
  useEffect(() => {
    if (previousActive.current === active) return;
    previousActive.current = active;
    if (mode === "sql") setSql(active);
  }, [active, mode, setSql]);

  const compile = (list: FilterCondition[], join: Combinator) =>
    compileFilterConditions(list, join, kind, columnDetails);

  const commit = (list: FilterCondition[], join: Combinator = combinator) => {
    const next = activeRuleConditions(list);
    const effective = orSupported ? join : "AND";
    setStored(next.length ? next : [emptyCondition()]);
    setCombinator(effective);
    setError("");
    onApply(compile(next, effective), false);
  };

  const addConditions = (list: FilterCondition[], join: Combinator = "AND"): string => {
    const incoming = activeRuleConditions(list);
    if (!incoming.length) return "Die Bedingung ist unvollständig.";
    const incomingJoin = incoming.length > 1 ? join : null;
    if (!shown.length) {
      commit(incoming, incomingJoin ?? combinator);
      return "";
    }
    const currentJoin = shown.length > 1 ? combinator : "AND";
    if (incomingJoin && incomingJoin !== currentJoin)
      return "„und“ und „oder“ gemischt bitte im SQL-Modus filtern.";
    commit([...shown, ...incoming], currentJoin);
    return "";
  };

  const updateCondition = (id: string, next: FilterCondition) =>
    commit(shown.map((condition) => (condition.id === id ? next : condition)));

  const removeCondition = (id: string) => commit(shown.filter((condition) => condition.id !== id));

  const applySql = (text: string) => {
    const value = json ? text.trim() : normalizeFilterExpressionQuotes(text.trim());
    setSql(value);
    setError("");
    onApply(value, value !== "");
  };

  const switchMode = (next: FilterMode) => {
    if (next === mode) return;
    setError("");
    if (next === "sql") {
      setSql(active || compile(shown, combinator));
      setMode("sql");
      return;
    }
    const source = sql.trim();
    if (source && source !== compiled) {
      if (json) {
        setError("Dieser JSON-Filter lässt sich nicht in Bausteine umwandeln.");
        return;
      }
      try {
        const parsed = parseFilterExpression(source, columns, parseKind);
        setMode("simple");
        commit(
          parsed.conditions.map((condition) => ({ ...condition, id: createId() })),
          parsed.combinator,
        );
      } catch (cause) {
        const reason =
          cause instanceof Error ? cause.message : "Filter konnte nicht gelesen werden.";
        setError(`${reason} Der Filter bleibt im ${sqlLabel}-Modus.`);
      }
      return;
    }
    setMode("simple");
    if (!source && active) commit([]);
  };

  const clearFilters = () => {
    setSql("");
    commit([]);
  };

  const addRule = (rule: RowRule) => setRules((current) => [...current, rule]);
  const updateRule = (rule: RowRule) =>
    setRules((current) => current.map((entry) => (entry.id === rule.id ? rule : entry)));
  const removeRule = (id: string) =>
    setRules((current) => current.filter((entry) => entry.id !== id));

  const aiContext = (): FilterAiContext => ({
    kind,
    json,
    mode,
    columns,
    columnDetails,
    conditions: shown,
    combinator,
    sql: mode === "sql" ? active : "",
    rules,
    today: localIsoDate(),
  });

  const applyProposal = (proposal: FilterAiProposal) => {
    if (proposal.rules) setRules(proposal.rules);
    if (proposal.sql !== null) {
      setMode("sql");
      applySql(proposal.sql);
    } else if (proposal.conditions) {
      commit(proposal.conditions, proposal.combinator);
    }
  };

  return {
    kind,
    json,
    mode,
    sqlLabel,
    orSupported,
    columns,
    columnDetails,
    conditions: shown,
    combinator,
    rawFilter: external && !parsedExternal ? external : "",
    rules,
    sql,
    setSql,
    sqlDirty: mode === "sql" && sql.trim() !== active,
    hasFilter: active !== "",
    error,
    setError,
    addConditions,
    updateCondition,
    removeCondition,
    setJoin: (join: Combinator) => commit(shown, join),
    applySql,
    switchMode,
    clearFilters,
    addRule,
    updateRule,
    removeRule,
    aiContext,
    applyProposal,
  };
}

export type FilterBarModel = ReturnType<typeof useFilterBarModel>;
