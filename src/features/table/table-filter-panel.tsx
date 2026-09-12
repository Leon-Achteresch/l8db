import {
  ChevronDownIcon,
  Code2Icon,
  FilterIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { lazy, Suspense, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { FilterOperatorSelect } from "@/features/filters/filter-operator-select";
import { FilterValueInput } from "@/features/filters/filter-value-input";
import { useActiveConnection } from "@/lib/connections";
import type { DetailedColumnInfo } from "@/lib/db";
import { useActiveCapabilities } from "@/lib/db-selection";
import { compileFilterConditions, filterSupportsOr, operatorNeedsValue } from "@/lib/sql-filter";

const SqlEditor = lazy(() =>
  import("@/features/table/sql-editor").then((module) => ({ default: module.SqlEditor })),
);

type FilterMode = "simple" | "sql";
type Combinator = "AND" | "OR";

interface Condition {
  id: string;
  column: string;
  operator: string;
  value: string;
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function emptyCondition(column = ""): Condition {
  return { id: createId(), column, operator: "eq", value: "" };
}

interface TableFilterPanelProps {
  columns: string[];
  columnDetails?: DetailedColumnInfo[];
  activeFilter: string;
  onApply: (where: string, isRaw: boolean) => void;
  onColumnSelect?: (column: string) => void;
}

export function TableFilterPanel({
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
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<FilterMode>("simple");
  const [conditions, setConditions] = useState<Condition[]>([emptyCondition()]);
  const [combinator, setCombinator] = useState<Combinator>("AND");
  const [sql, setSql] = useState("");

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

  const switchMode = (next: FilterMode) => {
    if (next === "sql" && sql.trim() === "" && compiledSimple !== "") {
      setSql(compiledSimple);
    }
    setMode(next);
  };

  const apply = () => {
    onApply(draft, native || mode === "sql");
    setOpen(true);
  };

  const reset = () => {
    setConditions([emptyCondition()]);
    setCombinator("AND");
    setSql("");
    onApply("", false);
  };

  return (
    <motion.div layout className="flex min-h-0 max-h-full flex-col border-b bg-muted/30">
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
          <Badge variant="secondary" className="min-w-0 gap-1 font-normal">
            <span className="max-w-[50vw] truncate font-mono text-xs sm:max-w-80">
              {activeFilter}
            </span>
            <button
              type="button"
              onClick={reset}
              aria-label="Filter entfernen"
              className="-mr-0.5 rounded-sm opacity-70 hover:opacity-100"
            >
              <XIcon className="size-3" />
            </button>
          </Badge>
        ) : (
          <span className="hidden text-xs text-muted-foreground sm:inline">Keine Filter aktiv</span>
        )}
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="filter-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.26, ease: [0.32, 0.72, 0, 1] },
              opacity: { duration: 0.18 },
            }}
            className="overflow-hidden"
          >
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
                    <div
                      key={condition.id}
                      className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
                    >
                      <div className="shrink-0 text-xs text-muted-foreground sm:w-16 sm:text-right">
                        {index === 0 ? (
                          "Wo"
                        ) : (
                          <Select
                            value={filterSupportsOr(kind) ? combinator : "AND"}
                            onValueChange={(value) => setCombinator(value as Combinator)}
                          >
                            <SelectTrigger size="sm" className="w-24 sm:w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent position="popper">
                              <SelectItem value="AND">und</SelectItem>
                              {filterSupportsOr(kind) && <SelectItem value="OR">oder</SelectItem>}
                            </SelectContent>
                          </Select>
                        )}
                      </div>

                      <Select
                        value={condition.column}
                        onValueChange={(value) => {
                          updateCondition(condition.id, { column: value });
                          onColumnSelect?.(value);
                        }}
                      >
                        <SelectTrigger size="sm" className="w-full min-w-0 sm:min-w-40 sm:flex-1">
                          <SelectValue placeholder="Spalte wählen…" />
                        </SelectTrigger>
                        <SelectContent position="popper" searchable>
                          {columns.map((column) => (
                            <SelectItem key={column} value={column}>
                              {column}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <FilterOperatorSelect
                        operator={condition.operator}
                        value={condition.value}
                        onChange={(operator, value) =>
                          updateCondition(condition.id, { operator, value })
                        }
                        className="w-full min-w-0 sm:w-auto sm:min-w-44"
                        size="sm"
                      />

                      {operatorNeedsValue(condition.operator) ? (
                        <FilterValueInput
                          key={condition.operator}
                          operator={condition.operator}
                          value={condition.value}
                          onValueChange={(value) =>
                            updateCondition(condition.id, {
                              value,
                            })
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              apply();
                            }
                          }}
                          placeholder="Wert"
                          className="h-8 w-full min-w-0 sm:min-w-32 sm:flex-1"
                        />
                      ) : (
                        <div className="hidden sm:block sm:min-w-32 sm:flex-1" />
                      )}

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeCondition(condition.id)}
                        aria-label="Bedingung entfernen"
                        className="self-end sm:self-auto"
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
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
                      onChange={setSql}
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
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
