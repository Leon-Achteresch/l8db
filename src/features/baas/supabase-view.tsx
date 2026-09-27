import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Cloud, ExternalLink, RefreshCw, Unplug } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  supabaseConnect,
  supabaseDisconnect,
  supabaseIsConnected,
  supabaseProjects,
} from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { SupabaseProjectView } from "./supabase-project-view";

export function SupabaseView() {
  const queryClient = useQueryClient();
  const connected = useQuery({ queryKey: ["supabase", "connected"], queryFn: supabaseIsConnected });
  const projects = useQuery({
    queryKey: ["supabase", "projects"],
    queryFn: supabaseProjects,
    enabled: connected.data === true,
  });
  const [token, setToken] = useState("");
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.supabase");
  const selected =
    projects.data?.find((project) => project.reference === selectedRef) ?? projects.data?.[0];

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const data = await supabaseConnect(token);
      queryClient.setQueryData(["supabase", "connected"], true);
      queryClient.setQueryData(["supabase", "projects"], data);
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
      await supabaseDisconnect();
      queryClient.setQueryData(["supabase", "connected"], false);
      queryClient.removeQueries({ queryKey: ["supabase", "projects"] });
      setSelectedRef(null);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] px-6 pb-8 lg:px-9">
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow mb-3">Cloud-Projekte</p>
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
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Erstelle in Supabase einen persönlichen Zugangstoken mit Leserechten für Projekte,
            Storage und Edge Functions. Für die Übernahme eines vorhandenen Secret API Keys werden
            zusätzlich API Keys: Read und API Key Secrets: Read benötigt. Der Token wird im
            OS-Schlüsselbund gespeichert.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void connect();
            }}
            className="mt-5 flex flex-col gap-3"
          >
            <Input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Supabase Personal Access Token"
              aria-label="Supabase Personal Access Token"
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" disabled={busy || !token.trim()} className="self-start">
              {busy ? "Verbinde…" : "Projekte laden"}
            </Button>
          </form>
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => void openUrl("https://supabase.com/dashboard/account/tokens")}
            className="mt-4 inline-flex items-center gap-1 text-xs text-primary underline"
          >
            Zugangstoken in Supabase erstellen <ExternalLink className="size-3" />
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
          ) : selected ? (
            <SupabaseProjectView key={selected.reference} project={selected} />
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
