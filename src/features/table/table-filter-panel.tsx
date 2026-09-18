import {
  ChevronDownIcon,
  Code2Icon,
  FilterIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { lazy, Suspense, useMemo, useState } from "react";
import { Collapse } from "@/components/motion/collapse";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useActiveConnection } from "@/lib/connections";
import type { DetailedColumnInfo } from "@/lib/db";
import { useActiveCapabilities } from "@/lib/db-selection";
import {
  normalizeFilterExpressionQuotes,
  type ParsedFilter,
  parseFilterExpression,
} from "@/lib/filter-parser";
import { useTableViewState } from "@/lib/hooks/use-table-view-state";
import { compileFilterConditions } from "@/lib/sql-filter";
import type { FilterCondition as Condition } from "@/lib/table-view-state";

import { ActiveFilterBadge } from "./table-filter-panel/active-filter-badge";
import { FilterConditionRow } from "./table-filter-panel/filter-condition-row";
import { createId, emptyCondition } from "./table-filter-panel/filter-conditions";
import type { FilterMode } from "./table-filter-panel/filter-types";

const SqlEditor = lazy(() =>
  import("@/features/table/sql-editor").then((module) => ({ default: module.SqlEditor })),
);

interface TableFilterPanelProps {
  stateKey?: string;
  columns: string[];
  columnDetails?: DetailedColumnInfo[];
  activeFilter: string;
  onApply: (where: string, isRaw: boolean) => void;
  onColumnSelect?: (column: string) => void;
}

export function TableFilterPanel({
  stateKey,
  columns,
  columnDetails,
  activeFilter,
  onApply,
  onColumnSelect,
}: TableFilterPanelProps) {
  const caps = useActiveCapabilities();
  const kind = useActiveConnection()?.kind;
  const json = caps.query_language === "json";
  const redis = caps.query_language === "redis";
  const native = redis;
  const [open, setOpen] = useTableViewState(stateKey, "filterOpen", false);
  const [mode, setMode] = useTableViewState(stateKey, "filterMode", "simple");
  const [conditions, setConditions] = useTableViewState(stateKey, "filterConditions", () => [
    emptyCondition(),
  ]);
  const [combinator, setCombinator] = useTableViewState(stateKey, "filterCombinator", "AND");
  const [sql, setSql] = useTableViewState(stateKey, "filterSql", "");
  const [parseError, setParseError] = useState("");
  const [badgeDraft, setBadgeDraft] = useState<string | null>(null);

  const compiledSimple = useMemo(
    () => compileFilterConditions(conditions, combinator, kind, columnDetails),
    [conditions, combinator, kind, columnDetails],
  );

  const draft = native || mode === "sql" ? sql.trim() : compiledSimple;
  const hasActiveFilter = activeFilter.trim() !== "";
  const isDirty = draft !== activeFilter.trim();

  const updateCondition = (id: string, patch: Partial<Condition>) => {
    setConditions((current) =>
      current.map((condition) => (condition.id === id ? { ...condition, ...patch } : condition)),
    );
  };

  const addCondition = () => {
    setConditions((current) => [...current, emptyCondition(columns[0] ?? "")]);
  };

  const removeCondition = (id: string) => {
    setConditions((current) => {
      const next = current.filter((condition) => condition.id !== id);
      return next.length > 0 ? next : [emptyCondition()];
    });
  };

  const importFilter = (parsed: ParsedFilter) => {
    setConditions(parsed.conditions.map((condition) => ({ ...condition, id: createId() })));
    setCombinator(parsed.combinator);
    setParseError("");
  };

  const switchMode = (next: FilterMode) => {
    if (next === mode) return;
    setParseError("");
    if (next === "simple" && !json && sql.trim() !== compiledSimple) {
      if (sql.trim()) {
        try {
          importFilter(parseFilterExpression(sql, columns, kind));
        } catch (cause) {
          setParseError(
            cause instanceof Error ? cause.message : "Filter konnte nicht gelesen werden.",
          );
          return;
        }
      } else {
        setConditions([emptyCondition()]);
        setCombinator("AND");
      }
    }
    if (next === "sql" && (!json || !sql.trim())) {
      setSql(compiledSimple);
    }
    setMode(next);
  };

  const apply = () => {
    const next =
      !native && !json && mode === "sql" ? normalizeFilterExpressionQuotes(draft) : draft;
    if (next !== draft) setSql(next);
    onApply(next, native || mode === "sql");
    setOpen(true);
  };

  const reset = () => {
    setBadgeDraft(null);
    setConditions([emptyCondition()]);
    setCombinator("AND");
    setSql("");
    setParseError("");
    onApply("", false);
  };

  return (
    <div className="flex min-h-0 max-h-full flex-col border-b bg-muted/30">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-1.5 text-sm font-medium text-foreground"
        >
          <FilterIcon className="size-4 text-muted-foreground" />
          Filter
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="inline-flex"
          >
            <ChevronDownIcon className="size-4 text-muted-foreground" />
          </motion.span>
        </button>

        {hasActiveFilter ? (
          <ActiveFilterBadge
            activeFilter={activeFilter}
            badgeDraft={badgeDraft}
            setBadgeDraft={setBadgeDraft}
            native={native}
            json={json}
            reset={reset}
            setSql={setSql}
            setMode={setMode}
            setParseError={setParseError}
            onApply={onApply}
          />
        ) : (
          <span className="hidden text-xs text-muted-foreground sm:inline">Keine Filter aktiv</span>
        )}
      </div>

      <Collapse open={open} durationMs={260}>
        <div className="min-h-0 max-h-[min(22rem,calc(55vh-7rem))] space-y-3 overflow-y-auto px-3 pb-3">
          {!native && (
            <Tabs value={mode} onValueChange={(value) => switchMode(value as FilterMode)}>
              <TabsList>
                <TabsTrigger value="simple">
                  <SlidersHorizontalIcon />
                  Einfach
                </TabsTrigger>
                <TabsTrigger value="sql">
                  <Code2Icon />
                  {json ? "JSON" : kind === "cassandra" ? "CQL" : "SQL"}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          {parseError && (
            <p role="alert" className="text-xs text-destructive">
              {parseError}
            </p>
          )}

          {redis ? (
            <Input
              aria-label="Redis-Key-Pattern"
              value={sql}
              onChange={(event) => setSql(event.target.value)}
              placeholder={caps.filter_hint}
              onKeyDown={(event) => {
                if (event.key === "Enter") apply();
              }}
              className="font-mono text-xs"
            />
          ) : json && mode === "sql" ? (
            <Textarea
              aria-label="MongoDB-Filter"
              value={sql}
              onChange={(event) => setSql(event.target.value)}
              placeholder={caps.filter_hint}
              className="h-36 font-mono text-xs"
            />
          ) : mode === "simple" ? (
            <div className="space-y-2">
              {conditions.map((condition, index) => (
                <FilterConditionRow
                  key={condition.id}
                  condition={condition}
                  index={index}
                  kind={kind}
                  combinator={combinator}
                  setCombinator={setCombinator}
                  columns={columns}
                  updateCondition={updateCondition}
                  removeCondition={removeCondition}
                  onColumnSelect={onColumnSelect}
                  apply={apply}
                />
              ))}

              <Button type="button" variant="outline" size="sm" onClick={addCondition}>
                <PlusIcon />
                Bedingung hinzufügen
              </Button>

              <p className="break-all font-mono text-xs text-muted-foreground">
                {compiledSimple === "" ? "" : `${json ? "JSON" : "WHERE"} ${compiledSimple}`}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Suspense
                fallback={
                  <div className="h-36" role="status">
                    Editor wird geladen…
                  </div>
                }
              >
                <SqlEditor
                  value={sql}
                  onChange={(value) => {
                    setSql(value);
                    setParseError("");
                  }}
                  onSubmit={apply}
                  columns={columns}
                  placeholder="z. B.  status = 'active' AND created_at > '2024-01-01'"
                  className="h-36"
                />
              </Suspense>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t bg-muted/30 px-3 py-2 sm:flex-row sm:items-center sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reset}
            disabled={!hasActiveFilter && draft === ""}
            className="w-full sm:w-auto"
          >
            <RotateCcwIcon />
            Zurücksetzen
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={apply}
            disabled={!isDirty}
            className="w-full sm:w-auto"
          >
            <PlayIcon />
            Filter anwenden
          </Button>
        </div>
      </Collapse>
    </div>
  );
}
