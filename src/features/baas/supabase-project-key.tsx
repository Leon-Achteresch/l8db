import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabaseDeleteProjectKey, supabaseHasProjectKey, supabaseSetProjectKey } from "@/lib/db";

export function SupabaseProjectKey({ reference }: { reference: string }) {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasKey = useQuery({
    queryKey: ["supabase", reference, "has-project-key"],
    queryFn: () => supabaseHasProjectKey(reference),
  });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await supabaseSetProjectKey(reference, apiKey);
      queryClient.setQueryData(["supabase", reference, "has-project-key"], true);
      await queryClient.invalidateQueries({ queryKey: ["supabase", reference, "objects"] });
      setApiKey("");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await supabaseDeleteProjectKey(reference);
      queryClient.setQueryData(["supabase", reference, "has-project-key"], false);
      queryClient.removeQueries({ queryKey: ["supabase", reference, "objects"] });
      queryClient.removeQueries({ queryKey: ["supabase", reference, "auth-users"] });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Projekt API Key</h3>
      </div>
      {hasKey.isPending ? (
        <p className="mt-3 text-xs text-muted-foreground">Zugriff wird geprüft…</p>
      ) : hasKey.isError ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {String(hasKey.error)}
        </p>
      ) : hasKey.data ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Storage-Dateien und Auth-Benutzer sind verbunden.
          </p>
          <Button variant="ghost" size="sm" onClick={() => void remove()} disabled={busy}>
            <Trash2 className="size-3.5" /> Key entfernen
          </Button>
        </div>
      ) : (
        <>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Für Storage-Dateien und Auth-Benutzer wird ein Secret API Key benötigt. Er wird nach
            erfolgreicher Prüfung im OS-Schlüsselbund gespeichert.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            className="mt-3 flex max-w-xl gap-2"
          >
            <Input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sb_secret_… oder service_role Key"
              aria-label="Supabase Secret API Key"
              autoComplete="off"
              spellCheck={false}
              className="min-w-0"
            />
            <Button type="submit" size="sm" disabled={busy || !apiKey.trim()}>
              Verbinden
            </Button>
          </form>
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
