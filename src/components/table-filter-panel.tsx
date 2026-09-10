import { useMemo, useState } from "react";

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

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SqlEditor } from "@/components/sql-editor";
import { cn } from "@/lib/utils";

type FilterMode = "simple" | "sql";
type Combinator = "AND" | "OR";

interface OperatorDef {
  key: string;
  label: string;
  needsValue: boolean;
}

const OPERATORS: OperatorDef[] = [
  { key: "eq", label: "ist gleich", needsValue: true },
  { key: "neq", label: "ist ungleich", needsValue: true },
  { key: "gt", label: "ist größer als", needsValue: true },
  { key: "gte", label: "ist größer/gleich", needsValue: true },
  { key: "lt", label: "ist kleiner als", needsValue: true },
  { key: "lte", label: "ist kleiner/gleich", needsValue: true },
  { key: "contains", label: "enthält", needsValue: true },
  { key: "startsWith", label: "beginnt mit", needsValue: true },
  { key: "endsWith", label: "endet mit", needsValue: true },
  { key: "isNull", label: "ist leer", needsValue: false },
  { key: "isNotNull", label: "ist nicht leer", needsValue: false },
];

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

function operatorNeedsValue(key: string): boolean {
  return OPERATORS.find((operator) => operator.key === key)?.needsValue ?? true;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  const trimmed = value.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed;
  }
  if (trimmed === "true" || trimmed === "false" || trimmed === "null") {
    return trimmed;
  }
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteLike(value: string): string {
  return value.replace(/'/g, "''").replace(/([%_\\])/g, "\\$1");
}

function compileCondition(condition: Condition): string | null {
  if (!condition.column) {
    return null;
  }
  if (operatorNeedsValue(condition.operator) && condition.value === "") {
    return null;
  }
  const column = quoteIdent(condition.column);
  switch (condition.operator) {
    case "eq":
      return `${column} = ${quoteLiteral(condition.value)}`;
    case "neq":
      return `${column} <> ${quoteLiteral(condition.value)}`;
    case "gt":
      return `${column} > ${quoteLiteral(condition.value)}`;
    case "gte":
      return `${column} >= ${quoteLiteral(condition.value)}`;
    case "lt":
      return `${column} < ${quoteLiteral(condition.value)}`;
    case "lte":
      return `${column} <= ${quoteLiteral(condition.value)}`;
    case "contains":
      return `${column}::text ILIKE '%${quoteLike(condition.value)}%'`;
    case "startsWith":
      return `${column}::text ILIKE '${quoteLike(condition.value)}%'`;
    case "endsWith":
      return `${column}::text ILIKE '%${quoteLike(condition.value)}'`;
    case "isNull":
      return `${column} IS NULL`;
    case "isNotNull":
      return `${column} IS NOT NULL`;
    default:
      return null;
  }
}

function compileConditions(
  conditions: Condition[],
  combinator: Combinator,
): string {
  const parts = conditions
    .map(compileCondition)
    .filter((part): part is string => part !== null);
  if (parts.length === 0) {
    return "";
  }
  return parts.join(` ${combinator} `);
}

interface TableFilterPanelProps {
  columns: string[];
  activeFilter: string;
  onApply: (where: string) => void;
}

export function TableFilterPanel({
  columns,
  activeFilter,
  onApply,
}: TableFilterPanelProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<FilterMode>("simple");
  const [conditions, setConditions] = useState<Condition[]>([
    emptyCondition(),
  ]);
  const [combinator, setCombinator] = useState<Combinator>("AND");
  const [sql, setSql] = useState("");

  const compiledSimple = useMemo(
    () => compileConditions(conditions, combinator),
    [conditions, combinator],
  );

  const draft = mode === "sql" ? sql.trim() : compiledSimple;
  const hasActiveFilter = activeFilter.trim() !== "";
  const isDirty = draft !== activeFilter.trim();

  const updateCondition = (id: string, patch: Partial<Condition>) => {
    setConditions((current) =>
      current.map((condition) =>
        condition.id === id ? { ...condition, ...patch } : condition,
      ),
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
    onApply(draft);
    setOpen(true);
  };

  const reset = () => {
    setConditions([emptyCondition()]);
    setCombinator("AND");
    setSql("");
    onApply("");
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
          <ChevronDownIcon
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
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
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Keine Filter aktiv – alle Zeilen werden angezeigt
          </span>
        )}
      </div>

      {open ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
          <Tabs
            value={mode}
            onValueChange={(value) => switchMode(value as FilterMode)}
          >
            <TabsList>
              <TabsTrigger value="simple">
                <SlidersHorizontalIcon />
                Einfach
              </TabsTrigger>
              <TabsTrigger value="sql">
                <Code2Icon />
                SQL
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {mode === "simple" ? (
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
                      <NativeSelect
                        size="sm"
                        value={combinator}
                        onChange={(event) =>
                          setCombinator(event.target.value as Combinator)
                        }
                        className="w-24 sm:w-full"
                      >
                        <NativeSelectOption value="AND">und</NativeSelectOption>
                        <NativeSelectOption value="OR">oder</NativeSelectOption>
                      </NativeSelect>
                    )}
                  </div>

                  <NativeSelect
                    size="sm"
                    value={condition.column}
                    onChange={(event) =>
                      updateCondition(condition.id, {
                        column: event.target.value,
                      })
                    }
                    className="w-full min-w-0 sm:min-w-40 sm:flex-1"
                  >
                    <NativeSelectOption value="" disabled>
                      Spalte wählen…
                    </NativeSelectOption>
                    {columns.map((column) => (
                      <NativeSelectOption key={column} value={column}>
                        {column}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>

                  <NativeSelect
                    size="sm"
                    value={condition.operator}
                    onChange={(event) =>
                      updateCondition(condition.id, {
                        operator: event.target.value,
                      })
                    }
                    className="w-full min-w-0 sm:w-auto sm:min-w-44"
                  >
                    {OPERATORS.map((operator) => (
                      <NativeSelectOption key={operator.key} value={operator.key}>
                        {operator.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>

                  {operatorNeedsValue(condition.operator) ? (
                    <Input
                      value={condition.value}
                      onChange={(event) =>
                        updateCondition(condition.id, {
                          value: event.target.value,
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

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addCondition}
              >
                <PlusIcon />
                Bedingung hinzufügen
              </Button>

              <p className="font-mono text-xs text-muted-foreground">
                {compiledSimple === ""
                  ? "Noch keine vollständige Bedingung."
                  : `WHERE ${compiledSimple}`}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <SqlEditor
                value={sql}
                onChange={setSql}
                onSubmit={apply}
                columns={columns}
                placeholder="z. B.  status = 'active' AND created_at > '2024-01-01'"
                className="h-36"
              />
              <p className="text-xs text-muted-foreground">
                SQL-Bedingung ohne <code className="font-mono">WHERE</code>.{" "}
                <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">
                  ⌘/Strg + ⏎
                </kbd>{" "}
                wendet an · Spaltennamen werden vorgeschlagen.
              </p>
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
        </div>
      ) : null}
    </div>
  );
}
