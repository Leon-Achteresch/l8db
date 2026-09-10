import { useCallback, useEffect, useMemo, useState } from "react";

import { useNavigate } from "@tanstack/react-router";
import {
  Code2Icon,
  ColumnsIcon,
  EyeIcon,
  FilterIcon,
  PlayIcon,
  PlusIcon,
  RegexIcon,
  RotateCcwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  TableIcon,
  Trash2Icon,
} from "lucide-react";

import { SqlEditor } from "@/components/table/sql-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import { useColumnsQuery, useTablesQuery, useViewsQuery } from "@/lib/queries";
import {
  OPERATORS,
  compileSingleCondition,
  operatorNeedsValue,
} from "@/lib/sql-filter";
import { useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";

function createId(): string {
  return crypto.randomUUID();
}

interface Condition {
  id: string;
  column: string;
  operator: string;
  value: string;
}

function emptyCondition(column = ""): Condition {
  return { id: createId(), column, operator: "eq", value: "" };
}

type Combinator = "AND" | "OR";
type FilterMode = "simple" | "sql";

function compileConditions(
  conditions: Condition[],
  combinator: Combinator,
): string {
  const parts = conditions
    .map((c) => compileSingleCondition(c.column, c.operator, c.value))
    .filter((part): part is string => part !== null);
  if (parts.length === 0) return "";
  return parts.join(` ${combinator} `);
}

function parsePatterns(
  raw: string,
  useRegex: boolean,
): ((name: string) => boolean)[] {
  const parts = raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return [];
  return parts.map((pattern) => {
    if (useRegex) {
      try {
        const re = new RegExp(pattern, "i");
        return (name: string) => re.test(name);
      } catch {
        const lower = pattern.toLowerCase();
        return (name: string) => name.toLowerCase().includes(lower);
      }
    }
    const lower = pattern.toLowerCase();
    return (name: string) => name.toLowerCase().includes(lower);
  });
}

interface MatchedEntity {
  schema: string;
  name: string;
  type: "table" | "view";
  matchingColumns: string[];
}

interface TableSearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TableSearchModal({ open, onOpenChange }: TableSearchModalProps) {
  const navigate = useNavigate();
  const openTab = useTableTabs((state) => state.openTab);

  const [nameQuery, setNameQuery] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [regexError, setRegexError] = useState<string | null>(null);

  const [filterMode, setFilterMode] = useState<FilterMode>("simple");
  const [conditions, setConditions] = useState<Condition[]>([emptyCondition()]);
  const [combinator, setCombinator] = useState<Combinator>("AND");
  const [sql, setSql] = useState("");

  const [selectedEntity, setSelectedEntity] = useState<MatchedEntity | null>(null);

  const { data: tables } = useTablesQuery();
  const { data: views } = useViewsQuery();
  const { data: tableColumns } = useColumnsQuery("BASE TABLE");
  const { data: viewColumns } = useColumnsQuery("VIEW");

  useEffect(() => {
    if (!open) return;
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
    const parts = nameQuery
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const p of parts) {
      try {
        new RegExp(p, "i");
      } catch (e) {
        setRegexError(e instanceof Error ? e.message : String(e));
        return;
      }
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
      const key = `${entity.type}:${entity.schema}.${entity.name}`;
      const cols = columnsByTable.get(key) ?? [];
      const matchingColumns = cols.filter((c) => matchers.some((m) => m(c)));
      if (nameMatches || fullMatches || matchingColumns.length > 0) {
        results.push({ ...entity, matchingColumns });
      }
    }
    return results;
  }, [tables, views, nameQuery, useRegex, columnsByTable]);

  const selectedColumns = useMemo(() => {
    if (!selectedEntity) return [];
    const key = `${selectedEntity.type}:${selectedEntity.schema}.${selectedEntity.name}`;
    return columnsByTable.get(key) ?? [];
  }, [selectedEntity, columnsByTable]);

  const compiledSimple = useMemo(
    () => compileConditions(conditions, combinator),
    [conditions, combinator],
  );
  const whereClause = filterMode === "sql" ? sql.trim() : compiledSimple;

  const updateCondition = (id: string, patch: Partial<Condition>) => {
    setConditions((cur) =>
      cur.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
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

  const handleSelectEntity = useCallback(
    (entity: MatchedEntity) => {
      setSelectedEntity(entity);
      setConditions([emptyCondition()]);
      setCombinator("AND");
      setSql("");
    },
    [],
  );

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
      },
    });
  }, [selectedEntity, whereClause, openTab, onOpenChange, navigate]);

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

  const tableResults = filteredEntities.filter((e) => e.type === "table");
  const viewResults = filteredEntities.filter((e) => e.type === "view");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Erweiterte Suche</DialogTitle>
        <DialogDescription>
          Tabellen und Views mit Regex, mehreren Mustern und SQL WHERE durchsuchen
        </DialogDescription>
      </DialogHeader>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        showCloseButton={false}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            placeholder="Tabellen & Views suchen... (mehrere mit ; trennen)"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            className={cn(
              "h-7 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground",
              regexError && "text-destructive",
            )}
            autoFocus
          />
          <Toggle
            size="sm"
            variant="outline"
            pressed={useRegex}
            onPressedChange={setUseRegex}
            aria-label="Regex-Modus"
            className="h-7 shrink-0 px-1.5"
          >
            <RegexIcon className="size-3.5" />
          </Toggle>
        </div>

        {regexError && (
          <p className="border-b px-3 py-1 text-xs text-destructive">
            Ungultiger Regex: {regexError}
          </p>
        )}

        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 w-1/2 flex-col border-r">
            <div className="flex items-center gap-2 border-b px-3 py-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {filteredEntities.length} Ergebnis{filteredEntities.length !== 1 ? "se" : ""}
              </span>
              {tableResults.length > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  <TableIcon className="size-2.5" />
                  {tableResults.length}
                </Badge>
              )}
              {viewResults.length > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  <EyeIcon className="size-2.5" />
                  {viewResults.length}
                </Badge>
              )}
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="py-1">
                {filteredEntities.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                    Keine Treffer
                  </p>
                ) : (
                  filteredEntities.map((entity) => {
                    const isSelected =
                      selectedEntity?.schema === entity.schema &&
                      selectedEntity?.name === entity.name &&
                      selectedEntity?.type === entity.type;
                    return (
                      <div key={`${entity.type}:${entity.schema}.${entity.name}`}>
                        <button
                          type="button"
                          onClick={() => handleSelectEntity(entity)}
                          onDoubleClick={() => handleOpenDirect(entity)}
                          className={cn(
                            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted/80",
                            isSelected && "bg-muted",
                          )}
                        >
                          {entity.type === "table" ? (
                            <TableIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <EyeIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                            {entity.schema}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {entity.name}
                          </span>
                        </button>
                        {entity.matchingColumns.length > 0 && (
                          <div className="ml-7 border-l border-border/40 py-0.5 pl-2">
                            {entity.matchingColumns.slice(0, 3).map((col) => (
                              <div
                                key={col}
                                className="flex items-center gap-1.5 px-1 py-0.5 text-[10px] text-muted-foreground"
                              >
                                <ColumnsIcon className="size-2.5 shrink-0" />
                                <span className="truncate">{col}</span>
                              </div>
                            ))}
                            {entity.matchingColumns.length > 3 && (
                              <span className="px-1 text-[10px] text-muted-foreground/60">
                                +{entity.matchingColumns.length - 3} weitere
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="flex min-h-0 w-1/2 flex-col">
            {selectedEntity ? (
              <>
                <div className="flex items-center gap-2 border-b px-3 py-1.5">
                  <FilterIcon className="size-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {selectedEntity.name}
                  </span>
                  {whereClause && (
                    <Badge variant="secondary" className="text-[10px]">
                      WHERE
                    </Badge>
                  )}
                </div>
                <div className="border-b px-3 py-2">
                  <Tabs
                    value={filterMode}
                    onValueChange={(v) => switchFilterMode(v as FilterMode)}
                  >
                    <TabsList className="w-full">
                      <TabsTrigger value="simple" className="flex-1">
                        <SlidersHorizontalIcon className="size-3" />
                        Einfach
                      </TabsTrigger>
                      <TabsTrigger value="sql" className="flex-1">
                        <Code2Icon className="size-3" />
                        SQL
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                <ScrollArea className="min-h-0 flex-1">
                  <div className="space-y-2 p-3">
                    {filterMode === "simple" ? (
                      <>
                        {conditions.map((condition, index) => (
                          <div
                            key={condition.id}
                            className="flex flex-col gap-1.5"
                          >
                            <div className="text-[10px] text-muted-foreground">
                              {index === 0 ? (
                                "Wo"
                              ) : (
                                <NativeSelect
                                  size="sm"
                                  value={combinator}
                                  onChange={(e) =>
                                    setCombinator(e.target.value as Combinator)
                                  }
                                  className="w-20"
                                >
                                  <NativeSelectOption value="AND">
                                    und
                                  </NativeSelectOption>
                                  <NativeSelectOption value="OR">
                                    oder
                                  </NativeSelectOption>
                                </NativeSelect>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <NativeSelect
                                size="sm"
                                value={condition.column}
                                onChange={(e) =>
                                  updateCondition(condition.id, {
                                    column: e.target.value,
                                  })
                                }
                                className="min-w-0 flex-1"
                              >
                                <NativeSelectOption value="" disabled>
                                  Spalte...
                                </NativeSelectOption>
                                {selectedColumns.map((col) => (
                                  <NativeSelectOption key={col} value={col}>
                                    {col}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelect>
                              <NativeSelect
                                size="sm"
                                value={condition.operator}
                                onChange={(e) =>
                                  updateCondition(condition.id, {
                                    operator: e.target.value,
                                  })
                                }
                                className="w-auto min-w-0 shrink-0"
                              >
                                {OPERATORS.map((op) => (
                                  <NativeSelectOption key={op.key} value={op.key}>
                                    {op.label}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelect>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => removeCondition(condition.id)}
                                aria-label="Bedingung entfernen"
                              >
                                <Trash2Icon />
                              </Button>
                            </div>
                            {operatorNeedsValue(condition.operator) && (
                              <Input
                                value={condition.value}
                                onChange={(e) =>
                                  updateCondition(condition.id, {
                                    value: e.target.value,
                                  })
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleOpen();
                                }}
                                placeholder="Wert"
                                className="h-7 text-xs"
                              />
                            )}
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={addCondition}
                          className="w-full"
                        >
                          <PlusIcon />
                          Bedingung
                        </Button>
                        {compiledSimple && (
                          <p className="break-all font-mono text-[10px] text-muted-foreground">
                            WHERE {compiledSimple}
                          </p>
                        )}
                      </>
                    ) : (
                      <SqlEditor
                        value={sql}
                        onChange={setSql}
                        onSubmit={handleOpen}
                        columns={selectedColumns}
                        placeholder="z.B. status = 'active' AND id > 100"
                        className="h-32"
                      />
                    )}
                  </div>
                </ScrollArea>

                <div className="flex items-center gap-2 border-t px-3 py-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={resetFilter}
                    disabled={!whereClause}
                  >
                    <RotateCcwIcon />
                  </Button>
                  <div className="flex-1" />
                  <Button
                    type="button"
                    size="xs"
                    onClick={handleOpen}
                  >
                    <PlayIcon />
                    Offnen
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                <FilterIcon className="size-8 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">
                  Tabelle auswahlen um Filter zu setzen
                </p>
                <p className="text-[10px] text-muted-foreground/60">
                  Doppelklick offnet direkt
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[10px] text-muted-foreground/60">
          <span>
            <kbd className="rounded border border-border/40 bg-background/60 px-1 font-sans">;</kbd>{" "}
            mehrere Muster
          </span>
          <span>Doppelklick = direkt offnen</span>
          {useRegex && (
            <span className="ml-auto font-mono text-blue-400/70">regex</span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
