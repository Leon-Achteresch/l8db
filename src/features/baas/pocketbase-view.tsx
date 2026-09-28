import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Cloud, ExternalLink, Plus, RefreshCw, Unplug } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pocketbaseConnect, pocketbaseDisconnect, pocketbaseProfiles } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { PocketBaseCollectionsView } from "./pocketbase-collections-view";

export function PocketBaseView({ initialId }: { initialId?: string }) {
  const queryClient = useQueryClient();
  const profiles = useQuery({ queryKey: ["pocketbase", "profiles"], queryFn: pocketbaseProfiles });
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.pocketbase");
  const selected = profiles.data?.find((item) => item.id === selectedId) ?? profiles.data?.[0];

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const profile = await pocketbaseConnect(endpoint, token);
      await queryClient.invalidateQueries({ queryKey: ["pocketbase", "profiles"] });
      setSelectedId(profile.id);
      setEndpoint("");
      setToken("");
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
      await pocketbaseDisconnect(selected.id);
      queryClient.removeQueries({ queryKey: ["pocketbase", selected.id] });
      await queryClient.invalidateQueries({ queryKey: ["pocketbase", "profiles"] });
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
            <h1 className="text-3xl font-semibold tracking-[-0.045em]">PocketBase</h1>
            {feature.isNew && <NewBadge />}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Collections, Auth-Datensätze und gespeicherte Dateien.
          </p>
        </div>
        {selected && (
          <Button variant="outline" size="sm" onClick={() => setAdding((value) => !value)}>
            <Plus className="size-3.5" /> Instanz hinzufügen
          </Button>
        )}
      </header>

      {profiles.isPending ? (
        <p className="text-sm text-muted-foreground">Instanzen werden geladen…</p>
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
              <h2 className="text-lg font-semibold">PocketBase verbinden</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Gib die Instanz-URL und einen Superuser-Impersonation-Token ein. Dieser Token hat
                vollständigen Zugriff auf die Instanz. l8db prüft ihn und speichert ihn im
                OS-Schlüsselbund. Über diese Ansicht kannst du Datensätze und Dateien verwalten.
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
                  placeholder="https://pocketbase.example.com"
                  aria-label="PocketBase Instanz-URL"
                  autoComplete="url"
                  required
                />
                <Input
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="Superuser-Token"
                  aria-label="PocketBase Superuser-Token"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
                <Button type="submit" disabled={busy || !endpoint || !token} className="self-start">
                  {busy ? "Verbinde…" : "Instanz verbinden"}
                </Button>
              </form>
              <button
                type="button"
                onClick={() => void openUrl("https://pocketbase.io/docs/authentication/#api-keys")}
                className="mt-4 inline-flex items-center gap-1 text-xs text-primary underline"
              >
                PocketBase-Tokens verstehen <ExternalLink className="size-3" />
              </button>
            </section>
          )}
          {selected && (
            <>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div
                  className="flex flex-wrap gap-2"
                  role="tablist"
                  aria-label="PocketBase-Instanzen"
                >
                  {profiles.data.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={selected.id === item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={`rounded-xl border px-3 py-2 text-sm transition-colors ${selected.id === item.id ? "border-primary/50 bg-primary/10 text-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
                    >
                      {item.name || new URL(item.endpoint).host}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void queryClient.invalidateQueries({ queryKey: ["pocketbase", selected.id] })
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
              <section className="mb-6 rounded-2xl border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight">{selected.name}</h2>
                    <p className="mt-2 break-all text-xs text-muted-foreground">
                      {selected.endpoint}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void openUrl(`${selected.endpoint}/_/`)}
                  >
                    PocketBase-Dashboard <ExternalLink className="size-3.5" />
                  </Button>
                </div>
              </section>
              <PocketBaseCollectionsView key={selected.id} id={selected.id} />
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
