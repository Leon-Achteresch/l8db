import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Cloud, ExternalLink, Plus, RefreshCw, Unplug } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { appwriteConnect, appwriteDisconnect, appwriteProfiles } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { AppwriteProjectView } from "./appwrite-project-view";

export function AppwriteView() {
  const queryClient = useQueryClient();
  const profiles = useQuery({ queryKey: ["appwrite", "profiles"], queryFn: appwriteProfiles });
  const [endpoint, setEndpoint] = useState("");
  const [projectId, setProjectId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.appwrite");
  const selected = profiles.data?.find((item) => item.id === selectedId) ?? profiles.data?.[0];

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const profile = await appwriteConnect(endpoint, projectId, apiKey);
      await queryClient.invalidateQueries({ queryKey: ["appwrite", "profiles"] });
      setSelectedId(profile.id);
      setEndpoint("");
      setProjectId("");
      setApiKey("");
      setAdding(false);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await appwriteDisconnect(selected.id);
      queryClient.removeQueries({ queryKey: ["appwrite", selected.id] });
      await queryClient.invalidateQueries({ queryKey: ["appwrite", "profiles"] });
      setSelectedId(null);
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
            <h1 className="text-3xl font-semibold tracking-[-0.045em]">Appwrite</h1>
            {feature.isNew && <NewBadge />}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Projekte, Storage, TablesDB, Funktionen, Nutzer und Sites.
          </p>
        </div>
        {selected && (
          <Button variant="outline" size="sm" onClick={() => setAdding((value) => !value)}>
            <Plus className="size-3.5" /> Projekt hinzufügen
          </Button>
        )}
      </header>

      {profiles.isPending ? (
        <p className="text-sm text-muted-foreground">Projekte werden geladen…</p>
      ) : profiles.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {String(profiles.error)}
        </p>
      ) : (
        <>
          {(!selected || adding) && (
            <section className="mb-6 max-w-xl rounded-2xl border bg-card p-6">
              <div className="mb-5 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Cloud className="size-5" />
              </div>
              <h2 className="text-lg font-semibold">Appwrite-Projekt verbinden</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Appwrite verwendet API-Schlüssel pro Projekt. Gib den API-Endpunkt, die Projekt-ID
                und einen Schlüssel mit Leserechten für die gewünschten Dienste ein. Der Schlüssel
                wird im OS-Schlüsselbund gespeichert.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void connect();
                }}
                className="mt-5 flex flex-col gap-3"
              >
                <Input
                  type="url"
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder="https://fra.cloud.appwrite.io/v1"
                  aria-label="Appwrite API-Endpunkt"
                  autoComplete="url"
                  required
                />
                <Input
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  placeholder="Projekt-ID"
                  aria-label="Appwrite Projekt-ID"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="API-Schlüssel"
                  aria-label="Appwrite API-Schlüssel"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
                <Button
                  type="submit"
                  disabled={busy || !endpoint || !projectId || !apiKey}
                  className="self-start"
                >
                  {busy ? "Verbinde…" : "Projekt verbinden"}
                </Button>
              </form>
              <button
                type="button"
                onClick={() => void openUrl("https://appwrite.io/docs/partners/project/api-keys")}
                className="mt-4 inline-flex items-center gap-1 text-xs text-primary underline"
              >
                API-Schlüssel in Appwrite erstellen <ExternalLink className="size-3" />
              </button>
            </section>
          )}
          {selected && (
            <>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2" role="tablist" aria-label="Appwrite-Projekte">
                  {profiles.data.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={selected.id === item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={`rounded-xl border px-3 py-2 text-sm transition-colors ${selected.id === item.id ? "border-primary/50 bg-primary/10 text-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void queryClient.invalidateQueries({ queryKey: ["appwrite", selected.id] })
                    }
                  >
                    <RefreshCw className="size-3.5" /> Aktualisieren
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void disconnect()}
                    disabled={busy}
                  >
                    <Unplug className="size-3.5" /> Trennen
                  </Button>
                </div>
              </div>
              <AppwriteProjectView key={selected.id} profile={selected} />
            </>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
