import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Eye, Plus, RefreshCw, Table2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { studioTablesList, studioTablesSchemas } from "@/lib/db/supabase-studio-tables";
import { BaasSidebarItem } from "../../baas-sidebar-item";
import { SupabaseTableCreateDialog } from "./supabase-table-create-dialog";
import { KIND_LABELS, type StudioTableRef } from "./supabase-tables-utils";

const ALL_SCHEMAS = "*";
const TABLE_PAGE = 100;

export function SupabaseTablesBrowser({
  reference,
  selected,
  onSelect,
}: {
  reference: string;
  selected: StudioTableRef | null;
  onSelect: (table: StudioTableRef) => void;
}) {
  const queryClient = useQueryClient();
  const [schema, setSchema] = useState("public");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const schemas = useQuery({
    queryKey: ["supabase", reference, "studio-tables", "schemas"],
    queryFn: () => studioTablesSchemas(reference),
    staleTime: 60_000,
  });
  const tables = useQuery({
    queryKey: ["supabase", reference, "studio-tables", "list", schema, applied, offset],
    queryFn: () =>
      studioTablesList(reference, schema === ALL_SCHEMAS ? "" : schema, applied, offset),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="grid min-w-0 content-start gap-2">
      <div className="flex gap-1">
        <Select
          value={schema}
          onValueChange={(value) => {
            setSchema(value);
            setOffset(0);
          }}
        >
          <SelectTrigger size="sm" className="h-8 min-w-0 flex-1 text-xs" aria-label="Schema">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_SCHEMAS}>Alle Schemas</SelectItem>
            {(schemas.data ?? ["public"]).map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Tabellen aktualisieren"
          disabled={tables.isFetching}
          onClick={() =>
            void queryClient.invalidateQueries({
              queryKey: ["supabase", reference, "studio-tables", "list"],
            })
          }
        >
          <RefreshCw className={`size-3.5 ${tables.isFetching ? "animate-spin" : ""}`} />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Tabelle erstellen"
          onClick={() => setCreating(true)}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(search.trim());
          setOffset(0);
        }}
      >
        <Input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            if (!event.target.value) {
              setApplied("");
              setOffset(0);
            }
          }}
          placeholder="Tabellen suchen (Enter)"
          aria-label="Tabellen suchen"
          spellCheck={false}
          className="h-8 text-xs"
        />
      </form>
      {tables.isPending ? (
        <p className="px-2 text-xs text-muted-foreground">Tabellen werden geladen…</p>
      ) : tables.isError ? (
        <p role="alert" className="text-xs text-destructive">
          {String(tables.error)}
        </p>
      ) : tables.data.tables.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">Keine Tabellen gefunden.</p>
      ) : (
        <div className="grid gap-0.5">
          {tables.data.tables.map((entry) => (
            <BaasSidebarItem
              key={`${entry.schema}.${entry.name}`}
              icon={entry.kind === "table" ? Table2 : Eye}
              active={selected?.schema === entry.schema && selected.name === entry.name}
              onClick={() => onSelect({ schema: entry.schema, name: entry.name })}
              title={[
                schema === ALL_SCHEMAS ? entry.schema : null,
                KIND_LABELS[entry.kind],
                entry.estimated_rows !== null ? `~${entry.estimated_rows} Zeilen` : null,
                entry.kind === "table" && !entry.rls_enabled ? "RLS aus" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              hint={entry.kind === "table" && !entry.rls_enabled ? "RLS aus" : undefined}
            >
              {schema === ALL_SCHEMAS ? `${entry.schema}.${entry.name}` : entry.name}
            </BaasSidebarItem>
          ))}
        </div>
      )}
      {tables.data && (offset > 0 || tables.data.has_more) && (
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Vorherige Tabellen"
            disabled={offset === 0}
            onClick={() => setOffset((value) => Math.max(0, value - TABLE_PAGE))}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {offset + 1}–{offset + tables.data.tables.length}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Weitere Tabellen"
            disabled={!tables.data.has_more}
            onClick={() => setOffset((value) => value + TABLE_PAGE)}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      )}
      {creating && (
        <SupabaseTableCreateDialog
          reference={reference}
          schemas={schemas.data ?? []}
          initialSchema={schema === ALL_SCHEMAS ? "public" : schema}
          onOpenChange={setCreating}
          onCreated={(table) => {
            void queryClient.invalidateQueries({
              queryKey: ["supabase", reference, "studio-tables", "list"],
            });
            onSelect(table);
          }}
        />
      )}
    </div>
  );
}
