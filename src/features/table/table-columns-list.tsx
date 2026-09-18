import { BinaryIcon, Columns2Icon, InfoIcon, KeyRoundIcon, SearchIcon, XIcon } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { DetailedColumnInfo } from "@/lib/db";
import { useDetailedColumnsQuery } from "@/lib/queries";

import { ColumnListItem } from "./table-columns-list/column-list-item";
import { matchesColumnFilter } from "./table-columns-list/column-type-config";

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
    (columns as DetailedColumnInfo[] | undefined)?.filter((column: DetailedColumnInfo) =>
      matchesColumnFilter(column, search, selectedFilter),
    ) ?? [];

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
            {filteredColumns.map((column: DetailedColumnInfo) => (
              <ColumnListItem
                key={column.name}
                column={column}
                isExpanded={expandedColumn === column.name}
                copiedColumn={copiedColumn}
                setExpandedColumn={setExpandedColumn}
                setCopiedColumn={setCopiedColumn}
              />
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}
