import {
  BinaryIcon,
  BracesIcon,
  CalendarIcon,
  CheckCheckIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  Columns2Icon,
  CopyIcon,
  HashIcon,
  InfoIcon,
  KeyRoundIcon,
  SearchIcon,
  TypeIcon,
  XIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { DetailedColumnInfo } from "@/lib/db";
import { useDetailedColumnsQuery } from "@/lib/queries";

interface TableColumnsListProps {
  schema: string;
  table: string;
}

export function TableColumnsList({ schema, table }: TableColumnsListProps) {
  const { data: columns, isLoading } = useDetailedColumnsQuery(schema, table);
  const [search, setSearch] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<string>("all");
  const [expandedColumn, setExpandedColumn] = useState<string | null>(null);
  const [copiedColumn, setCopiedColumn] = useState<string | null>(null);

  const count = columns?.length ?? 0;

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground h-full min-h-[300px]">
        <Spinner />
        Lade Spalten…
      </div>
    );
  }

  if (count === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 h-full min-h-[300px]">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Keine Spalten vorhanden.</p>
        </div>
      </div>
    );
  }

  const getTypeConfig = (dataType: string, isPrimaryKey: boolean) => {
    const lower = dataType.toLowerCase();
    if (isPrimaryKey) {
      return {
        icon: KeyRoundIcon,
        color: "text-amber-500 bg-amber-500/10 border-amber-500/20",
        label: "Primary Key",
        badgeColor: "bg-amber-500/10 text-amber-500 border-amber-500/20",
      };
    }
    if (
      lower.includes("int") ||
      lower.includes("numeric") ||
      lower.includes("double") ||
      lower.includes("real") ||
      lower.includes("decimal") ||
      lower.includes("serial") ||
      lower.includes("float")
    ) {
      return {
        icon: HashIcon,
        color: "text-blue-500 bg-blue-500/10 border-blue-500/20",
        label: "Numerisch",
        badgeColor: "bg-blue-500/10 text-blue-500 border-blue-500/20",
      };
    }
    if (
      lower.includes("char") ||
      lower.includes("text") ||
      lower.includes("varchar") ||
      lower.includes("uuid") ||
      lower.includes("xml")
    ) {
      return {
        icon: TypeIcon,
        color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
        label: "Text",
        badgeColor: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
      };
    }
    if (lower.includes("time") || lower.includes("date") || lower.includes("interval")) {
      return {
        icon: CalendarIcon,
        color: "text-purple-500 bg-purple-500/10 border-purple-500/20",
        label: "Datum/Zeit",
        badgeColor: "bg-purple-500/10 text-purple-500 border-purple-500/20",
      };
    }
    if (lower.includes("bool")) {
      return {
        icon: CheckIcon,
        color: "text-teal-500 bg-teal-500/10 border-teal-500/20",
        label: "Boolean",
        badgeColor: "bg-teal-500/10 text-teal-500 border-teal-500/20",
      };
    }
    if (lower.includes("json")) {
      return {
        icon: BracesIcon,
        color: "text-pink-500 bg-rose-500/10 border-rose-500/20",
        label: "JSON",
        badgeColor: "bg-rose-500/10 text-rose-500 border-rose-500/20",
      };
    }
    return {
      icon: BinaryIcon,
      color: "text-slate-500 bg-slate-500/10 border-slate-500/20",
      label: "Andere",
      badgeColor: "bg-slate-500/10 text-slate-500 border-slate-500/20",
    };
  };

  const pkCount =
    (columns as DetailedColumnInfo[] | undefined)?.filter(
      (c: DetailedColumnInfo) => c.is_primary_key,
    ).length ?? 0;
  const notNullCount =
    (columns as DetailedColumnInfo[] | undefined)?.filter((c: DetailedColumnInfo) => !c.is_nullable)
      .length ?? 0;
  const defaultCount =
    (columns as DetailedColumnInfo[] | undefined)?.filter(
      (c: DetailedColumnInfo) => c.column_default !== null,
    ).length ?? 0;

  const filteredColumns =
    (columns as DetailedColumnInfo[] | undefined)?.filter((column: DetailedColumnInfo) => {
      const matchesSearch =
        column.name.toLowerCase().includes(search.toLowerCase()) ||
        column.data_type.toLowerCase().includes(search.toLowerCase());

      if (!matchesSearch) return false;

      if (selectedFilter === "all") return true;
      if (selectedFilter === "pk") return column.is_primary_key;
      if (selectedFilter === "not-null") return !column.is_nullable;
      if (selectedFilter === "has-default") return column.column_default !== null;

      const lower = column.data_type.toLowerCase();
      if (selectedFilter === "numeric") {
        return (
          lower.includes("int") ||
          lower.includes("numeric") ||
          lower.includes("double") ||
          lower.includes("real") ||
          lower.includes("decimal") ||
          lower.includes("serial") ||
          lower.includes("float")
        );
      }
      if (selectedFilter === "text") {
        return (
          lower.includes("char") ||
          lower.includes("text") ||
          lower.includes("varchar") ||
          lower.includes("uuid") ||
          lower.includes("xml")
        );
      }
      if (selectedFilter === "date") {
        return lower.includes("time") || lower.includes("date") || lower.includes("interval");
      }
      if (selectedFilter === "boolean") {
        return lower.includes("bool");
      }
      if (selectedFilter === "json") {
        return lower.includes("json");
      }

      return true;
    }) ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex flex-col gap-3 border-b bg-muted/20 p-4 shrink-0">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Spalten nach Name oder Typ filtern..."
              className="pl-9 pr-8"
            />
            {search && (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setSearch("")}
                className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 hover:bg-transparent"
              >
                <XIcon className="size-3.5 text-muted-foreground hover:text-foreground" />
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <motion.div
            layout="position"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={() => setSelectedFilter("all")}
            className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors ${
              selectedFilter === "all"
                ? "border-primary bg-primary/5 shadow-xs"
                : "border-border bg-card hover:bg-muted/50"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className="rounded-md bg-muted p-1.5 text-foreground">
                <Columns2Icon className="size-4" />
              </div>
              <span className="text-xs font-medium text-muted-foreground">Gesamt</span>
            </div>
            <span className="text-sm font-semibold text-foreground">{count}</span>
          </motion.div>

          <motion.div
            layout="position"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={() => setSelectedFilter("pk")}
            className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors ${
              selectedFilter === "pk"
                ? "border-amber-500 bg-amber-500/5 shadow-xs"
                : "border-border bg-card hover:bg-muted/50"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className="rounded-md bg-amber-500/10 p-1.5 text-amber-500">
                <KeyRoundIcon className="size-4" />
              </div>
              <span className="text-xs font-medium text-muted-foreground">Primary Keys</span>
            </div>
            <span className="text-sm font-semibold text-foreground">{pkCount}</span>
          </motion.div>

          <motion.div
            layout="position"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={() => setSelectedFilter("not-null")}
            className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors ${
              selectedFilter === "not-null"
                ? "border-blue-500 bg-blue-500/5 shadow-xs"
                : "border-border bg-card hover:bg-muted/50"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className="rounded-md bg-blue-500/10 p-1.5 text-blue-500">
                <InfoIcon className="size-4" />
              </div>
              <span className="text-xs font-medium text-muted-foreground">Not Null</span>
            </div>
            <span className="text-sm font-semibold text-foreground">{notNullCount}</span>
          </motion.div>

          <motion.div
            layout="position"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={() => setSelectedFilter("has-default")}
            className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors ${
              selectedFilter === "has-default"
                ? "border-purple-500 bg-purple-500/5 shadow-xs"
                : "border-border bg-card hover:bg-muted/50"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className="rounded-md bg-purple-500/10 p-1.5 text-purple-500">
                <BinaryIcon className="size-4" />
              </div>
              <span className="text-xs font-medium text-muted-foreground">Default</span>
            </div>
            <span className="text-sm font-semibold text-foreground">{defaultCount}</span>
          </motion.div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-muted/50 pt-2.5">
          <Button
            size="xs"
            variant={selectedFilter === "all" ? "default" : "outline"}
            onClick={() => setSelectedFilter("all")}
          >
            Alle
          </Button>
          <Button
            size="xs"
            variant={selectedFilter === "numeric" ? "default" : "outline"}
            onClick={() => setSelectedFilter("numeric")}
          >
            Numerisch
          </Button>
          <Button
            size="xs"
            variant={selectedFilter === "text" ? "default" : "outline"}
            onClick={() => setSelectedFilter("text")}
          >
            Text
          </Button>
          <Button
            size="xs"
            variant={selectedFilter === "date" ? "default" : "outline"}
            onClick={() => setSelectedFilter("date")}
          >
            Datum/Zeit
          </Button>
          <Button
            size="xs"
            variant={selectedFilter === "boolean" ? "default" : "outline"}
            onClick={() => setSelectedFilter("boolean")}
          >
            Boolean
          </Button>
          <Button
            size="xs"
            variant={selectedFilter === "json" ? "default" : "outline"}
            onClick={() => setSelectedFilter("json")}
          >
            JSON
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {filteredColumns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Columns2Icon className="size-8 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              Keine Spalten entsprechen den aktuellen Filtern.
            </p>
            {(search || selectedFilter !== "all") && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => {
                  setSearch("");
                  setSelectedFilter("all");
                }}
              >
                Filter zurücksetzen
              </Button>
            )}
          </div>
        ) : (
          <motion.div
            variants={{
              hidden: { opacity: 0 },
              visible: {
                opacity: 1,
                transition: { staggerChildren: 0.02 },
              },
            }}
            initial="hidden"
            animate="visible"
            className="flex flex-col gap-2"
          >
            {filteredColumns.map((column: DetailedColumnInfo) => {
              const dataType =
                column.character_maximum_length != null
                  ? `${column.data_type}(${column.character_maximum_length})`
                  : column.data_type;

              const isExpanded = expandedColumn === column.name;
              const typeConfig = getTypeConfig(column.data_type, column.is_primary_key);
              const IconComponent = typeConfig.icon;

              return (
                <motion.div
                  key={column.name}
                  layout
                  variants={{
                    hidden: { opacity: 0, y: 8 },
                    visible: { opacity: 1, y: 0 },
                  }}
                  className={`group flex flex-col rounded-xl border transition-all duration-200 ${
                    isExpanded
                      ? "border-primary/50 bg-primary/[0.02] shadow-sm"
                      : "border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/30"
                  }`}
                >
                  <div
                    onClick={() => setExpandedColumn(isExpanded ? null : column.name)}
                    className="flex cursor-pointer items-center gap-3 p-3.5"
                  >
                    <span className="w-5 shrink-0 text-right text-xs font-semibold text-muted-foreground/60 tabular-nums">
                      {column.ordinal_position}
                    </span>

                    <div className={`rounded-lg border p-1.5 shrink-0 ${typeConfig.color}`}>
                      <IconComponent className="size-4" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold tracking-tight text-foreground">
                          {column.name}
                        </span>
                        {column.is_primary_key && (
                          <Badge
                            variant="outline"
                            className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[10px] py-0 px-1.5 shrink-0 font-medium"
                          >
                            PK
                          </Badge>
                        )}
                        {!column.is_nullable && (
                          <Badge
                            variant="outline"
                            className="bg-muted text-foreground/80 border-border text-[10px] py-0 px-1.5 shrink-0 font-medium"
                          >
                            NOT NULL
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-xs text-muted-foreground/80 bg-muted/40 px-2 py-0.5 rounded border border-border/50 shrink-0">
                        {dataType}
                      </span>

                      {column.column_default != null && (
                        <div className="hidden max-w-[8rem] sm:max-w-[12rem] truncate font-mono text-[10px] text-muted-foreground/60 bg-muted/20 px-1.5 py-0.5 rounded border shrink-0 md:block">
                          {column.column_default}
                        </div>
                      )}

                      <div className="text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0">
                        {isExpanded ? (
                          <ChevronUpIcon className="size-4" />
                        ) : (
                          <ChevronDownIcon className="size-4" />
                        )}
                      </div>
                    </div>
                  </div>

                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-muted/40 bg-muted/10 p-4">
                          <div className="grid grid-cols-2 gap-4 text-xs md:grid-cols-4">
                            <div className="bg-card border rounded-lg p-2.5">
                              <div className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider mb-1">
                                Position
                              </div>
                              <div className="font-mono text-foreground font-semibold text-sm">
                                {column.ordinal_position}
                              </div>
                            </div>
                            <div className="bg-card border rounded-lg p-2.5">
                              <div className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider mb-1">
                                Datentyp
                              </div>
                              <div
                                className="font-mono text-foreground font-semibold text-sm truncate"
                                title={column.data_type}
                              >
                                {column.data_type}
                              </div>
                            </div>
                            <div className="bg-card border rounded-lg p-2.5">
                              <div className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider mb-1">
                                Nullable
                              </div>
                              <div className="font-mono text-foreground font-semibold text-sm">
                                {column.is_nullable ? "YES" : "NO"}
                              </div>
                            </div>
                            <div className="bg-card border rounded-lg p-2.5">
                              <div className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider mb-1">
                                Standardwert
                              </div>
                              <div
                                className="font-mono text-foreground font-semibold text-sm truncate"
                                title={column.column_default ?? "Keiner"}
                              >
                                {column.column_default ?? "NULL"}
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 flex items-center justify-between border-t border-muted/30 pt-3">
                            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                              Spalte für Abfragen kopieren oder im SQL Editor verwenden
                            </span>
                            <Button
                              size="xs"
                              variant="outline"
                              className="h-7 gap-1.5 px-2.5 text-[11px]"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(column.name);
                                setCopiedColumn(column.name);
                                setTimeout(() => setCopiedColumn(null), 1500);
                              }}
                            >
                              {copiedColumn === column.name ? (
                                <>
                                  <CheckCheckIcon className="size-3.5 text-emerald-500" />
                                  Kopiert!
                                </>
                              ) : (
                                <>
                                  <CopyIcon className="size-3.5" />
                                  Namen kopieren
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </div>
    </div>
  );
}
