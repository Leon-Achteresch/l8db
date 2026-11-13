import { Columns2Icon, SearchIcon, XIcon } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { FeatureEmptyState } from "@/components/feature-empty-state/feature-empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAlterTable } from "@/features/alter-table/alter-table-view/use-alter-table";
import { capabilitiesFor, supports } from "@/lib/providers";
import { cn } from "@/lib/utils";
import { ColumnListItem } from "./table-columns-list/column-list-item";
import { columnFilterCounts, matchesColumnFilter } from "./table-columns-list/column-type-config";
import { TableCommentBar } from "./table-comment-bar";

interface TableColumnsListProps {
  schema: string;
  table: string;
  editable?: boolean;
}

export function TableColumnsList({ schema, table, editable = false }: TableColumnsListProps) {
  const {
    connection,
    columns,
    isLoading,
    isError,
    error,
    editingColumn,
    editForm,
    setEditForm,
    saving,
    handleStartEdit,
    handleCancelEdit,
    handleSaveEdit,
  } = useAlterTable(schema, table);
  const [search, setSearch] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<string>("all");
  const [copiedColumn, setCopiedColumn] = useState<string | null>(null);

  const count = columns?.length ?? 0;
  const constraints = supports(connection, "constraints");
  const terms = capabilitiesFor(connection?.kind).terms;
  const filters = useMemo(
    () => columnFilterCounts(columns ?? [], constraints),
    [columns, constraints],
  );
  const canEdit = editable && !!connection && supports(connection, "alter_columns");

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground h-full min-h-[300px]">
        <Spinner />
        Lade {terms.columns}…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 h-full min-h-[300px]">
        <p role="alert" className="text-sm text-destructive">
          {error instanceof Error ? error.message : String(error)}
        </p>
      </div>
    );
  }

  if (count === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 h-full min-h-[300px]">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Keine {terms.columns} vorhanden.</p>
        </div>
      </div>
    );
  }

  const filteredColumns =
    columns?.filter((column) => matchesColumnFilter(column, search, selectedFilter)) ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <TableCommentBar schema={schema} table={table} />
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3 pb-2">
        <div className="relative w-64 max-w-full">
          <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`${terms.columns} filtern…`}
            className="h-8 border-transparent bg-muted/50 pr-8 pl-8 text-xs shadow-none dark:bg-muted/50"
          />
          {search && (
            <Button
              size="icon"
              variant="ghost"
              aria-label="Suche leeren"
              onClick={() => setSearch("")}
              className="absolute top-1/2 right-1 size-6 -translate-y-1/2 hover:bg-transparent"
            >
              <XIcon className="size-3.5 text-muted-foreground hover:text-foreground" />
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              aria-pressed={selectedFilter === filter.id}
              onClick={() => setSelectedFilter(filter.id)}
              className={cn(
                "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                selectedFilter === filter.id
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <span>{filter.label}</span>
              <span className="tabular-nums opacity-60">{filter.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-4">
        {filteredColumns.length === 0 ? (
          <FeatureEmptyState
            icon={Columns2Icon}
            title="Kein Treffer für die Filter"
            action={{
              label: "Filter zurücksetzen",
              onClick: () => {
                setSearch("");
                setSelectedFilter("all");
              },
            }}
          />
        ) : (
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[minmax(190px,1.5fr)_minmax(145px,1fr)_90px_minmax(180px,1.3fr)_4rem] gap-3 px-3 py-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
              <span>{terms.column}</span>
              <span>Datentyp</span>
              <span>NULL</span>
              <span>Standardwert</span>
              <span />
            </div>
            <motion.div
              variants={{
                hidden: { opacity: 0 },
                visible: { opacity: 1, transition: { staggerChildren: 0.02 } },
              }}
              initial="hidden"
              animate="visible"
              className="flex flex-col"
            >
              {filteredColumns.map((column) => (
                <ColumnListItem
                  key={column.name}
                  column={column}
                  copiedColumn={copiedColumn}
                  setCopiedColumn={setCopiedColumn}
                  editable={canEdit}
                  editing={editingColumn === column.name}
                  editForm={editForm}
                  setEditForm={setEditForm}
                  kind={connection?.kind}
                  saving={saving}
                  onStartEdit={() => handleStartEdit(column)}
                  onCancelEdit={handleCancelEdit}
                  onSaveEdit={handleSaveEdit}
                />
              ))}
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
}
