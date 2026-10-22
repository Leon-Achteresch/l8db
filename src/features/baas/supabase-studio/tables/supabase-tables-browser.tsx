import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
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
        <p className="text-xs text-muted-foreground">Tabellen werden geladen…</p>
      ) : tables.isError ? (
        <p role="alert" className="text-xs text-destructive">
          {String(tables.error)}
        </p>
      ) : tables.data.tables.length === 0 ? (
        <p className="text-xs text-muted-foreground">Keine Tabellen gefunden.</p>
      ) : (
        <div className="max-h-[60vh] overflow-auto rounded-lg border">
          {tables.data.tables.map((entry) => {
            const active = selected?.schema === entry.schema && selected.name === entry.name;
            return (
              <button
                key={`${entry.schema}.${entry.name}`}
                type="button"
                aria-pressed={active}
                onClick={() => onSelect({ schema: entry.schema, name: entry.name })}
                className={`block w-full border-b px-3 py-1.5 text-left text-xs last:border-b-0 ${active ? "bg-primary/10 text-foreground" : "hover:bg-muted"}`}
              >
                <span className="block truncate font-mono">{entry.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {schema === ALL_SCHEMAS ? `${entry.schema} · ` : ""}
                  {KIND_LABELS[entry.kind]}
                  {entry.estimated_rows !== null ? ` · ~${entry.estimated_rows} Zeilen` : ""}
                  {entry.kind === "table" && !entry.rls_enabled ? " · RLS aus" : ""}
                </span>
              </button>
            );
          })}
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
