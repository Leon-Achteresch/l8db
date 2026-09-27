import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Cloud, ExternalLink, Plus, RefreshCw, Unplug } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { firebaseConnect, firebaseDisconnect, firebaseProfiles } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { FirebaseProjectView } from "./firebase-project-view";

export function FirebaseView() {
  const queryClient = useQueryClient();
  const profiles = useQuery({ queryKey: ["firebase", "profiles"], queryFn: firebaseProfiles });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.firebase");
  const selected =
    profiles.data?.find((item) => item.projectId === selectedId) ?? profiles.data?.[0];

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const profile = await firebaseConnect();
      if (profile) {
        await queryClient.invalidateQueries({ queryKey: ["firebase", "profiles"] });
        setSelectedId(profile.projectId);
        setAdding(false);
      }
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
      await firebaseDisconnect(selected.projectId);
      queryClient.removeQueries({ queryKey: ["firebase", selected.projectId] });
      await queryClient.invalidateQueries({ queryKey: ["firebase", "profiles"] });
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
            <h1 className="text-3xl font-semibold tracking-[-0.045em]">Firebase</h1>
            {feature.isNew && <NewBadge />}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Projekte, Cloud Storage, Firestore und Auth.
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
              <h2 className="text-lg font-semibold">Firebase-Projekt verbinden</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Wähle eine Service-Account-JSON-Datei aus dem Firebase-Projekt. l8db liest sie nur
                im Backend und speichert den Schlüssel im OS-Schlüsselbund. Die IAM-Rolle muss die
                gewünschten Projektdienste lesen dürfen.
              </p>
              <Button className="mt-5" disabled={busy} onClick={() => void connect()}>
                {busy ? "Verbinde…" : "Service-Account-Datei auswählen"}
              </Button>
              <button
                type="button"
                onClick={() => void openUrl("https://firebase.google.com/docs/admin/setup")}
                className="mt-4 flex items-center gap-1 text-xs text-primary underline"
              >
                Service-Account-Datei erstellen <ExternalLink className="size-3" />
              </button>
            </section>
          )}
          {selected && (
            <>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2" role="tablist" aria-label="Firebase-Projekte">
                  {profiles.data.map((item) => (
                    <button
                      key={item.projectId}
                      type="button"
                      role="tab"
                      aria-selected={selected.projectId === item.projectId}
                      onClick={() => setSelectedId(item.projectId)}
                      className={`rounded-xl border px-3 py-2 text-sm transition-colors ${selected.projectId === item.projectId ? "border-primary/50 bg-primary/10 text-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
                    >
                      {item.displayName || item.projectId}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void queryClient.invalidateQueries({
                        queryKey: ["firebase", selected.projectId],
                      })
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
              <FirebaseProjectView key={selected.projectId} profile={selected} />
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
