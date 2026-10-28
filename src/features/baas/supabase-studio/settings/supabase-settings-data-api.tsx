import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type SupabasePostgrestUpdate,
  supabaseStudioSettingsPostgrest,
  supabaseStudioSettingsUpdatePostgrest,
} from "@/lib/db/supabase-studio-settings";

export function SupabaseSettingsDataApi({ reference }: { reference: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["supabase", reference, "studio-settings-postgrest"];
  const config = useQuery({
    queryKey,
    queryFn: () => supabaseStudioSettingsPostgrest(reference),
  });
  const [draft, setDraft] = useState<Partial<Record<keyof SupabasePostgrestUpdate, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = (key: keyof SupabasePostgrestUpdate) =>
    draft[key] ?? String(config.data?.[key] ?? "");
  const dirty = Object.keys(draft).length > 0;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const updated = await supabaseStudioSettingsUpdatePostgrest(reference, {
        db_schema: field("db_schema"),
        max_rows: Number(field("max_rows")),
        db_extra_search_path: field("db_extra_search_path"),
      });
      queryClient.setQueryData(queryKey, updated);
      setDraft({});
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <Globe2 className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Data API</h3>
      </div>
      {config.isPending ? (
        <p className="mt-3 text-xs text-muted-foreground">Einstellungen werden geladen…</p>
      ) : config.isError ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {String(config.error)}
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="mt-4 grid max-w-2xl gap-3"
        >
          {(
            [
              ["db_schema", "Exponierte Schemas", "Kommagetrennt, z. B. public,graphql_public"],
              [
                "db_extra_search_path",
                "Zusätzlicher Suchpfad",
                "Kommagetrennt, z. B. public,extensions",
              ],
              ["max_rows", "Maximale Zeilen pro Antwort", "1 bis 1.000.000"],
            ] as const
          ).map(([key, label, hint]) => (
            <div key={key} className="grid gap-1.5">
              <label
                htmlFor={`supabase-postgrest-${key}-${reference}`}
                className="text-xs font-medium"
              >
                {label}
              </label>
              <Input
                id={`supabase-postgrest-${key}-${reference}`}
                value={field(key)}
                inputMode={key === "max_rows" ? "numeric" : undefined}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [key]: event.target.value }))
                }
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-[11px] text-muted-foreground">{hint}</p>
            </div>
          ))}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || !dirty}>
              {busy ? "Speichere…" : "Speichern"}
            </Button>
            {dirty && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setDraft({})}>
                Verwerfen
              </Button>
            )}
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
