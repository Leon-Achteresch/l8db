import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  type SupabaseRealtimePublication as Publication,
  supabaseRealtimePublicationActions,
  supabaseRealtimeTables,
  supabaseRealtimeToggleTable,
} from "@/lib/db/supabase-studio-edge";

const PAGE_SIZE = 100;
const ACTIONS = ["insert", "update", "delete", "truncate"] as const;

export function SupabaseRealtimePublication({ reference }: { reference: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const page = useQuery({
    queryKey: ["supabase", reference, "realtime-publication", search, offset],
    queryFn: () => supabaseRealtimeTables(reference, search, offset),
    placeholderData: keepPreviousData,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["supabase", reference, "realtime-publication"] });
  const toggle = useMutation({
    mutationFn: (input: { schema: string; name: string; enabled: boolean }) =>
      supabaseRealtimeToggleTable(reference, input.schema, input.name, input.enabled),
    onSuccess: refresh,
  });
  const actions = useMutation({
    mutationFn: (next: Pick<Publication, (typeof ACTIONS)[number]>) =>
      supabaseRealtimePublicationActions(reference, next),
    onSuccess: refresh,
  });
  const publication = page.data?.publication ?? null;
  const error = page.error ?? toggle.error ?? actions.error;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3 text-xs">
        <span className="font-medium">supabase_realtime</span>
        {publication
          ? ACTIONS.map((action) => (
              <div key={action} className="flex items-center gap-1.5">
                <Switch
                  id={`realtime-action-${action}`}
                  size="sm"
                  checked={publication[action]}
                  disabled={actions.isPending}
                  onCheckedChange={(checked) =>
                    actions.mutate({
                      insert: publication.insert,
                      update: publication.update,
                      delete: publication.delete,
                      truncate: publication.truncate,
                      [action]: checked,
                    })
                  }
                />
                <Label htmlFor={`realtime-action-${action}`}>{action.toUpperCase()}</Label>
              </div>
            ))
          : page.data && (
              <span className="text-muted-foreground">
                Publikation fehlt. Sie wird beim ersten Aktivieren einer Tabelle angelegt.
              </span>
            )}
        {publication?.all_tables && (
          <span className="text-muted-foreground">Umfasst alle Tabellen (FOR ALL TABLES).</span>
        )}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(draft.trim());
          setOffset(0);
        }}
      >
        <div className="relative min-w-48 flex-1">
          <Search className="absolute top-2 left-2 size-4 text-muted-foreground" />
          <Input
            className="h-8 pl-8 text-xs"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Tabellen suchen…"
            aria-label="Tabellen suchen"
          />
        </div>
        <Button size="sm" type="submit" variant="outline">
          Suchen
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {String(error)}
        </p>
      )}
      {page.isLoading && <p className="text-xs text-muted-foreground">Tabellen werden geladen…</p>}
      {page.data && (
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Schema</th>
              <th className="py-1 font-medium">Tabelle</th>
              <th className="w-24 py-1 font-medium">Realtime</th>
            </tr>
          </thead>
          <tbody>
            {page.data.tables.map((table) => (
              <tr key={`${table.schema}.${table.name}`} className="border-t">
                <td className="py-1.5 font-mono text-muted-foreground">{table.schema}</td>
                <td className="py-1.5 font-mono">{table.name}</td>
                <td>
                  <Switch
                    size="sm"
                    checked={table.enabled}
                    disabled={toggle.isPending || Boolean(publication?.all_tables)}
                    aria-label={`Realtime für ${table.schema}.${table.name}`}
                    onCheckedChange={(enabled) =>
                      toggle.mutate({ schema: table.schema, name: table.name, enabled })
                    }
                  />
                </td>
              </tr>
            ))}
            {page.data.tables.length === 0 && (
              <tr>
                <td colSpan={3} className="py-3 text-muted-foreground">
                  Keine Tabellen gefunden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Vorherige Seite"
          disabled={offset === 0 || page.isFetching}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Nächste Seite"
          disabled={!page.data?.has_more || page.isFetching}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
