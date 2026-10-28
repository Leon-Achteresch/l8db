import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, EyeOff, KeyRound } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { copyWithToast } from "@/lib/clipboard";
import type { SupabaseProject, SupabaseStudioCapabilities } from "@/lib/db";
import {
  supabaseStudioSettingsApiKeys,
  supabaseStudioSettingsReplaceSelfHostedKey,
  supabaseStudioSettingsRevealKey,
} from "@/lib/db/supabase-studio-settings";
import { SupabaseProjectKey } from "../../supabase-project-key";

export function SupabaseSettingsApi({
  project,
  capabilities,
}: {
  project: SupabaseProject;
  capabilities: SupabaseStudioCapabilities;
}) {
  const queryClient = useQueryClient();
  const url = (project.api_url ?? `https://${project.reference}.supabase.co`).replace(/\/$/, "");
  const [revealed, setRevealed] = useState(false);
  const [usePublic, setUsePublic] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stored = useQuery({
    queryKey: ["supabase", project.reference, "studio-settings-stored-key"],
    queryFn: () => supabaseStudioSettingsRevealKey(project.reference),
    enabled: capabilities.data_api && (revealed || (usePublic && project.self_hosted)),
    staleTime: 0,
    gcTime: 0,
  });
  const keys = useQuery({
    queryKey: ["supabase", project.reference, "studio-settings-api-keys"],
    queryFn: () => supabaseStudioSettingsApiKeys(project.reference),
    enabled: usePublic && capabilities.management,
  });
  const publicKey = project.self_hosted
    ? !capabilities.service_key
      ? stored.data
      : undefined
    : (keys.data?.find((key) => key.type === "publishable")?.api_key ??
      keys.data?.find((key) => key.name === "anon")?.api_key ??
      undefined);
  const canInsertPublic =
    capabilities.management || (project.self_hosted && !capabilities.service_key);
  const snippet = `NEXT_PUBLIC_SUPABASE_URL=${url}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${(usePublic && publicKey) || "<dein-publishable-oder-anon-key>"}`;
  const keyType = capabilities.service_key
    ? "Secret/service_role Key"
    : capabilities.data_api
      ? "Publishable/anon Key"
      : "Kein Projekt-Key gespeichert";

  async function replaceKey() {
    setBusy(true);
    setError(null);
    try {
      await supabaseStudioSettingsReplaceSelfHostedKey(project.reference, apiKey);
      setApiKey("");
      setRevealed(false);
      await queryClient.invalidateQueries({ queryKey: ["supabase"] });
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
        <h3 className="text-sm font-semibold">API</h3>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-[160px_minmax(0,1fr)]">
        <dt className="text-xs text-muted-foreground">Projekt-URL</dt>
        <dd className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-xs">{url}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Projekt-URL kopieren"
            onClick={() => void copyWithToast(url, "Projekt-URL")}
          >
            <Copy className="size-3.5" />
          </Button>
        </dd>
        <dt className="text-xs text-muted-foreground">Gespeicherter Key</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-xs">{keyType}</span>
          {capabilities.data_api && (
            <Button variant="ghost" size="sm" onClick={() => setRevealed((value) => !value)}>
              {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              {revealed ? "Verbergen" : "Anzeigen"}
            </Button>
          )}
        </dd>
      </dl>
      {revealed && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border bg-background/50 px-3 py-2">
          <code className="min-w-0 flex-1 truncate text-xs">
            {stored.isPending ? "…" : stored.isError ? String(stored.error) : stored.data}
          </code>
          {stored.data && !capabilities.service_key && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Key kopieren"
              onClick={() => void copyWithToast(stored.data, "Key")}
            >
              <Copy className="size-3.5" />
            </Button>
          )}
        </div>
      )}
      {capabilities.service_key && revealed && (
        <p className="mt-2 text-[11px] text-destructive">
          Secret Keys umgehen Row Level Security und gehören nie in Browser- oder App-Code.
        </p>
      )}

      <div className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-semibold">Verbindung für Apps</h4>
          <div className="flex gap-1">
            {canInsertPublic && (
              <Button variant="ghost" size="sm" onClick={() => setUsePublic((value) => !value)}>
                {usePublic ? "Platzhalter verwenden" : "Publishable Key einsetzen"}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void copyWithToast(snippet, "Umgebungsvariablen")}
            >
              <Copy className="size-3.5" /> Kopieren
            </Button>
          </div>
        </div>
        <pre className="mt-2 overflow-x-auto rounded-lg border bg-background/50 p-3 font-mono text-xs">
          {snippet}
        </pre>
        {usePublic && keys.isError && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {String(keys.error)}
          </p>
        )}
      </div>

      {project.self_hosted ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void replaceKey();
          }}
          className="mt-5 flex max-w-xl flex-col gap-2"
        >
          <label
            htmlFor={`supabase-replace-key-${project.reference}`}
            className="text-xs font-medium"
          >
            Key ersetzen
          </label>
          <div className="flex gap-2">
            <Input
              id={`supabase-replace-key-${project.reference}`}
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Publishable/anon Key oder Secret/service_role Key"
              autoComplete="off"
              spellCheck={false}
              className="min-w-0"
            />
            <Button type="submit" size="sm" disabled={busy || !apiKey.trim()}>
              {busy ? "Prüfe…" : "Prüfen & speichern"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Der neue Key wird gegen /auth/v1/settings geprüft und ersetzt danach den gespeicherten.
          </p>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </form>
      ) : (
        <div className="mt-5">
          <SupabaseProjectKey key={project.reference} reference={project.reference} />
        </div>
      )}
    </section>
  );
}
