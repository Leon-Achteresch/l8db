import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Cloud, ExternalLink, RefreshCw, Unplug } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  supabaseConnect,
  supabaseConnectSelfHosted,
  supabaseDisconnect,
  supabaseDisconnectSelfHosted,
  supabaseIsConnected,
  supabaseProjects,
} from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { BaasStudioHeader } from "./baas-studio-header";
import { SupabaseStudio } from "./supabase-studio/supabase-studio";

export function SupabaseView({ initialId }: { initialId?: string }) {
  const queryClient = useQueryClient();
  const connected = useQuery({ queryKey: ["supabase", "connected"], queryFn: supabaseIsConnected });
  const projects = useQuery({
    queryKey: ["supabase", "projects"],
    queryFn: supabaseProjects,
    enabled: connected.data === true,
  });
  const [token, setToken] = useState("");
  const [selfHosted, setSelfHosted] = useState(false);
  const [apiUrl, setApiUrl] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const selfHostedFeature = useNewFeatureVisibility<HTMLDivElement>("baas.supabase.self-hosted");
  const [selectedRef, setSelectedRef] = useState<string | null>(initialId || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.supabase");
  const selected =
    projects.data?.find((project) => project.reference === selectedRef) ?? projects.data?.[0];

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      if (selfHosted) {
        const project = await supabaseConnectSelfHosted(apiUrl, token, instanceName);
        queryClient.setQueryData(["supabase", "connected"], true);
        await queryClient.invalidateQueries({ queryKey: ["supabase", "projects"] });
        setApiUrl("");
        setInstanceName("");
        setToken("");
        setSelectedRef(project.reference);
        return;
      }
      const data = await supabaseConnect(token);
      queryClient.setQueryData(["supabase", "connected"], true);
      await queryClient.invalidateQueries({ queryKey: ["supabase", "projects"] });
      setToken("");
      setSelectedRef(data[0]?.reference ?? null);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      if (selected?.self_hosted) await supabaseDisconnectSelfHosted(selected.reference);
      else await supabaseDisconnect();
      queryClient.removeQueries({ queryKey: ["supabase", "projects"] });
      await queryClient.invalidateQueries({ queryKey: ["supabase", "connected"] });
      setSelectedRef(null);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  if (connected.data && projects.data && selected)
    return (
      <SupabaseStudio
        key={selected.reference}
        project={selected}
        header={
          <BaasStudioHeader
            label="Supabase-Projekt"
            items={projects.data.map((project) => ({ id: project.reference, label: project.name }))}
            value={selected.reference}
            onSelect={setSelectedRef}
            onRefresh={() => void projects.refetch()}
            refreshing={projects.isFetching}
            onDisconnect={() => void disconnect()}
            busy={busy}
            error={error ?? (projects.isError ? String(projects.error) : null)}
          />
        }
      />
    );

  return (
    <div className="mx-auto max-w-[1400px] px-6 pb-8 lg:px-9">
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow mb-3">Cloud und selbst gehostet</p>
          <div ref={feature.ref} className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-[-0.045em]">Supabase</h1>
            {feature.isNew && <NewBadge />}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Projekte, Storage, Auth und Edge Functions.
          </p>
        </div>
      </header>

      {connected.isPending ? (
        <p className="text-sm text-muted-foreground">Verbindung wird geprüft…</p>
      ) : connected.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {String(connected.error)}
        </p>
      ) : !connected.data ? (
        <section className="max-w-xl rounded-2xl border bg-card p-6">
          <div className="mb-5 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Cloud className="size-5" />
          </div>
          <h2 className="text-lg font-semibold">Supabase verbinden</h2>
          <div ref={selfHostedFeature.ref} className="mt-3 flex items-center gap-2">
            <fieldset aria-label="Hosting" className="m-0 flex min-w-0 rounded-lg border p-0.5">
              {[false, true].map((option) => (
                <button
                  key={String(option)}
                  type="button"
                  aria-pressed={selfHosted === option}
                  onClick={() => {
                    setSelfHosted(option);
                    setToken("");
                    setError(null);
                  }}
                  className={`rounded-md px-3 py-1 text-xs transition-colors ${selfHosted === option ? "bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {option ? "Projekt-URL & Key" : "Cloud"}
                </button>
              ))}
            </fieldset>
            {selfHostedFeature.isNew && <NewBadge />}
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {selfHosted
              ? "Gib NEXT_PUBLIC_SUPABASE_URL und einen Publishable/anon Key oder Secret/service_role Key ein, Cloud oder selbst gehostet. Mit Publishable/anon Key liest l8db wie deine App (RLS), ein Secret Key schaltet Tabellenliste, Auth-Benutzer und Bucket-Verwaltung frei. Der Schlüssel wird im OS-Schlüsselbund gespeichert."
              : "Erstelle in Supabase einen persönlichen Zugangstoken mit Leserechten für Projekte, Storage und Edge Functions. Für die Datenbankvorschau wird Database: Read benötigt; für die Übernahme eines vorhandenen Secret API Keys zusätzlich API Keys: Read und API Key Secrets: Read. Der Token wird im OS-Schlüsselbund gespeichert."}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void connect();
            }}
            className="mt-5 flex flex-col gap-3"
          >
            {selfHosted && (
              <>
                <Input
                  value={apiUrl}
                  onChange={(event) => setApiUrl(event.target.value)}
                  placeholder="Projekt-URL (NEXT_PUBLIC_SUPABASE_URL)"
                  aria-label="Supabase Projekt-URL"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Input
                  value={instanceName}
                  onChange={(event) => setInstanceName(event.target.value)}
                  placeholder="Name (optional)"
                  aria-label="Name der Supabase-Instanz"
                  autoComplete="off"
                />
              </>
            )}
            <Input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={
                selfHosted
                  ? "Publishable/anon Key oder Secret/service_role Key"
                  : "Supabase Personal Access Token"
              }
              aria-label={selfHosted ? "Supabase API Key" : "Supabase Personal Access Token"}
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              type="submit"
              disabled={busy || !token.trim() || (selfHosted && !apiUrl.trim())}
              className="self-start"
            >
              {busy ? "Verbinde…" : selfHosted ? "Projekt verbinden" : "Projekte laden"}
            </Button>
          </form>
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() =>
              void openUrl(
                selfHosted
                  ? "https://supabase.com/docs/guides/self-hosting/docker"
                  : "https://supabase.com/dashboard/account/tokens",
              )
            }
            className="mt-4 inline-flex items-center gap-1 text-xs text-primary underline"
          >
            {selfHosted ? "Supabase-Doku zum Self-Hosting" : "Zugangstoken in Supabase erstellen"}{" "}
            <ExternalLink className="size-3" />
          </button>
        </section>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Supabase-Projekte">
              {projects.data?.map((project) => (
                <button
                  key={project.reference}
                  type="button"
                  role="tab"
                  aria-selected={selected?.reference === project.reference}
                  onClick={() => setSelectedRef(project.reference)}
                  className={`rounded-xl border px-3 py-2 text-sm transition-colors ${selected?.reference === project.reference ? "border-primary/50 bg-primary/10 text-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
                >
                  {project.name}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void projects.refetch()}
                disabled={projects.isFetching}
              >
                <RefreshCw className={`size-3.5 ${projects.isFetching ? "animate-spin" : ""}`} />
                Aktualisieren
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void disconnect()} disabled={busy}>
                <Unplug className="size-3.5" />
                Trennen
              </Button>
            </div>
          </div>
          {error && (
            <p role="alert" className="mb-4 text-sm text-destructive">
              {error}
            </p>
          )}
          {projects.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {String(projects.error)}
            </p>
          ) : projects.isPending ? (
            <p className="text-sm text-muted-foreground">Projekte werden geladen…</p>
          ) : (
            <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
              Für diesen Zugangstoken sind keine Projekte sichtbar.
            </p>
          )}
        </>
      )}
    </div>
  );
}
