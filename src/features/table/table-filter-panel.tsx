import {
  ChevronDownIcon,
  Code2Icon,
  FilterIcon,
  PaletteIcon,
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
import { useListAnimation } from "@/lib/hooks/use-list-animation";
import { useTableViewState } from "@/lib/hooks/use-table-view-state";
import { activeRuleConditions, describeRule } from "@/lib/row-rules";
import { compileFilterConditions } from "@/lib/sql-filter";
import type { FilterCondition as Condition } from "@/lib/table-view-state";
import { ActiveFilterBadge } from "./table-filter-panel/active-filter-badge";
import { FilterConditionRow } from "./table-filter-panel/filter-condition-row";
import { createId, emptyCondition } from "./table-filter-panel/filter-conditions";
import type { Combinator, FilterMode } from "./table-filter-panel/filter-types";
import { RowRuleBadge } from "./table-filter-panel/row-rule-badge";
import { RuleColorPopover } from "./table-filter-panel/rule-color-popover";

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
  const listRef = useListAnimation<HTMLDivElement>();
  const caps = useActiveCapabilities();
  const kind = useActiveConnection()?.kind;
  const json = caps.query_language === "json";
  const redis = caps.query_language === "redis";
  const native = redis;
  const [open, setOpen] = useTableViewState(stateKey, "filterOpen", false);
  const [mode, setMode] = useTableViewState(stateKey, "filterMode", "simple");
  const [filterConditions, setFilterConditions] = useTableViewState(
    stateKey,
    "filterConditions",
    () => [emptyCondition()],
  );
  const [filterCombinator, setFilterCombinator] = useTableViewState(
    stateKey,
    "filterCombinator",
    "AND",
  );
  const [rules, setRules] = useTableViewState(stateKey, "rowRules", []);
  const [ruleMode, setRuleMode] = useState(false);
  const [ruleColor, setRuleColor] = useState("#3b82f6");
  const [ruleConditions, setRuleConditions] = useState(() => [emptyCondition()]);
  const [ruleCombinator, setRuleCombinator] = useState<Combinator>("AND");
  const conditions = ruleMode ? ruleConditions : filterConditions;
  const setConditions = ruleMode ? setRuleConditions : setFilterConditions;
  const combinator = ruleMode ? ruleCombinator : filterCombinator;
  const setCombinator = ruleMode ? setRuleCombinator : setFilterCombinator;
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
    setFilterConditions(parsed.conditions.map((condition) => ({ ...condition, id: createId() })));
    setFilterCombinator(parsed.combinator);
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
        setFilterConditions([emptyCondition()]);
        setFilterCombinator("AND");
      }
    }
    if (next === "sql" && (!json || !sql.trim())) {
      setSql(compiledSimple);
    }
    setMode(next);
  };

  const addRule = () => {
    const active = activeRuleConditions(ruleConditions);
    if (!active.length) return;
    setRules((current) => [
      ...current,
      { id: createId(), color: ruleColor, combinator: ruleCombinator, conditions: active },
    ]);
    setRuleConditions([emptyCondition()]);
    setRuleCombinator("AND");
  };

  const apply = () => {
    if (ruleMode) {
      addRule();
      return;
    }
    const next =
      !native && !json && mode === "sql" ? normalizeFilterExpressionQuotes(draft) : draft;
    if (next !== draft) setSql(next);
    onApply(next, native || mode === "sql");
    setOpen(true);
  };

  const reset = () => {
    setBadgeDraft(null);
    setFilterConditions([emptyCondition()]);
    setFilterCombinator("AND");
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

        {rules.map((rule) => (
          <RowRuleBadge
            key={rule.id}
            color={rule.color}
            label={describeRule(rule.conditions, rule.combinator)}
            onRemove={() => setRules((current) => current.filter((item) => item.id !== rule.id))}
          />
        ))}

        {!native && (
          <RuleColorPopover
            color={ruleColor}
            setColor={setRuleColor}
            ruleMode={ruleMode}
            setRuleMode={(value) => {
              setRuleMode(value);
              if (value) setOpen(true);
            }}
          />
        )}
      </div>

      <Collapse open={open} durationMs={260}>
        <div className="min-h-0 max-h-[min(22rem,calc(55vh-7rem))] space-y-3 overflow-y-auto px-3 pb-3">
          {!native && !ruleMode && (
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
          ) : json && mode === "sql" && !ruleMode ? (
            <Textarea
              aria-label="MongoDB-Filter"
              value={sql}
              onChange={(event) => setSql(event.target.value)}
              placeholder={caps.filter_hint}
              className="h-36 font-mono text-xs"
            />
          ) : mode === "simple" || ruleMode ? (
            <div ref={listRef} className="space-y-2">
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
                {compiledSimple === ""
                  ? ""
                  : ruleMode
                    ? `Markiert: ${describeRule(conditions, combinator)}`
                    : `${json ? "JSON" : "WHERE"} ${compiledSimple}`}
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
          {!ruleMode && (
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
          )}
          {ruleMode ? (
            <Button
              type="button"
              size="sm"
              onClick={addRule}
              disabled={activeRuleConditions(ruleConditions).length === 0}
              className="w-full sm:w-auto"
            >
              <PaletteIcon style={{ color: ruleColor }} />
              Regel hinzufügen
            </Button>
          ) : (
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
          )}
        </div>
      </Collapse>
    </div>
  );
}
