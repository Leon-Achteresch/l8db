import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NameConfirmDialog } from "@/features/versioning/database/name-confirm-dialog";
import {
  supabaseStudioSettingsPostgresConfig,
  supabaseStudioSettingsUpdatePostgresConfig,
} from "@/lib/db/supabase-studio-settings";

const SETTINGS: [string, string][] = [
  ["max_connections", "Ganzzahl"],
  ["shared_buffers", "z. B. 128MB"],
  ["effective_cache_size", "z. B. 384MB"],
  ["work_mem", "z. B. 4MB"],
  ["maintenance_work_mem", "z. B. 64MB"],
  ["statement_timeout", "z. B. 8s oder 0"],
  ["checkpoint_timeout", "z. B. 5min"],
  ["max_wal_size", "z. B. 1GB"],
  ["wal_keep_size", "z. B. 0MB"],
  ["max_worker_processes", "Ganzzahl"],
  ["max_parallel_workers", "Ganzzahl"],
  ["max_parallel_workers_per_gather", "Ganzzahl"],
  ["max_parallel_maintenance_workers", "Ganzzahl"],
  ["max_locks_per_transaction", "Ganzzahl"],
  ["max_replication_slots", "Ganzzahl"],
  ["max_wal_senders", "Ganzzahl"],
  ["max_slot_wal_keep_size", "Ganzzahl in MB, -1 = unbegrenzt"],
  ["wal_sender_timeout", "z. B. 60s"],
  ["session_replication_role", "origin, replica oder local"],
];

export function SupabaseSettingsPostgres({ reference }: { reference: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["supabase", reference, "studio-settings-postgres"];
  const config = useQuery({
    queryKey,
    queryFn: () => supabaseStudioSettingsPostgresConfig(reference),
  });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [restart, setRestart] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = Object.fromEntries(
    Object.entries(draft).filter(
      ([key, value]) => value.trim() !== "" && value.trim() !== String(config.data?.[key] ?? ""),
    ),
  );
  const dirty = Object.keys(changed).length > 0;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const updated = await supabaseStudioSettingsUpdatePostgresConfig(reference, changed, restart);
      queryClient.setQueryData(queryKey, updated);
      setDraft({});
      setRestart(false);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Postgres-Konfiguration</h3>
      </div>
      {config.isPending ? (
        <p className="mt-3 text-xs text-muted-foreground">Konfiguration wird geladen…</p>
      ) : config.isError ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {String(config.error)}
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setConfirming(true);
          }}
          className="mt-4 space-y-3"
        >
          <p className="text-[11px] text-muted-foreground">
            Leere Felder nutzen den Supabase-Standard. Nur geänderte Werte werden gesendet.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SETTINGS.map(([key, hint]) => (
              <div key={key} className="grid gap-1">
                <label
                  htmlFor={`supabase-pg-${key}-${reference}`}
                  className="font-mono text-[11px]"
                >
                  {key}
                </label>
                <Input
                  id={`supabase-pg-${key}-${reference}`}
                  value={draft[key] ?? String(config.data?.[key] ?? "")}
                  placeholder={hint}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, [key]: event.target.value }))
                  }
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-xs"
                />
              </div>
            ))}
          </div>
          <label
            htmlFor={`supabase-pg-restart-${reference}`}
            className="flex items-center gap-2 text-xs"
          >
            <Checkbox
              id={`supabase-pg-restart-${reference}`}
              checked={restart}
              onCheckedChange={(value) => setRestart(value === true)}
            />
            Datenbank neu starten, damit Änderungen sofort greifen
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || !dirty}>
              {busy ? "Speichere…" : "Speichern"}
            </Button>
            {Object.keys(draft).length > 0 && (
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
      {confirming && (
        <NameConfirmDialog
          title="Postgres-Konfiguration ändern?"
          description={
            restart
              ? "Die Datenbank wird neu gestartet. Laufende Verbindungen werden getrennt."
              : "Einige Einstellungen greifen erst nach einem Neustart der Datenbank."
          }
          name=""
          requireName={false}
          action="Übernehmen"
          destructive={restart}
          onConfirm={() => void save()}
          onClose={() => setConfirming(false)}
        >
          <ul className="space-y-1 font-mono text-xs">
            {Object.entries(changed).map(([key, value]) => (
              <li key={key}>
                {key} = {value.trim()}
              </li>
            ))}
          </ul>
        </NameConfirmDialog>
      )}
    </section>
  );
}
