import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, Plus, RefreshCw, Server, Unplug } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  convexConnect,
  convexConnectSelfHosted,
  convexDisconnect,
  convexProfiles,
  convexProjects,
} from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { ConvexEnvironmentView } from "./convex-environment-view";
import { ConvexProjectView } from "./convex-project-view";

export function ConvexView({ initialId }: { initialId?: string }) {
  const queryClient = useQueryClient();
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.convex");
  const selfHostedFeature = useNewFeatureVisibility<HTMLDivElement>("baas.convex.self-hosted");
  const [selfHosted, setSelfHosted] = useState(false);
  const [url, setUrl] = useState("");
  const profiles = useQuery({ queryKey: ["convex", "profiles"], queryFn: convexProfiles });
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? null);
  const [adding, setAdding] = useState(false);
  const [teamId, setTeamId] = useState("");
  const [token, setToken] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = profiles.data?.find((item) => item.id === selectedId) ?? profiles.data?.[0];
  const projects = useQuery({
    queryKey: ["convex", selected?.id, "projects", cursor],
    queryFn: () => {
      if (!selected) throw new Error("Kein Convex-Team gewählt.");
      return convexProjects(selected.id, cursor ?? undefined);
    },
    enabled: Boolean(selected) && !selected?.url,
  });

  async function connect() {
    if (selfHosted) {
      setBusy(true);
      setError(null);
      try {
        const profile = await convexConnectSelfHosted(url, token);
        await queryClient.invalidateQueries({ queryKey: ["convex", "profiles"] });
        setSelectedId(profile.id);
        setUrl("");
        setToken("");
        setAdding(false);
      } catch (reason) {
        setError(String(reason));
      } finally {
        setBusy(false);
      }
      return;
    }
    const id = Number(teamId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      setError("Bitte eine gültige numerische Team-ID eingeben.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const profile = await convexConnect(id, token);
      await queryClient.invalidateQueries({ queryKey: ["convex", "profiles"] });
      setSelectedId(profile.id);
      setTeamId("");
      setToken("");
      setAdding(false);
      setCursor(null);
      setHistory([]);
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
      await convexDisconnect(selected.id);
      queryClient.removeQueries({ queryKey: ["convex", selected.id] });
      await queryClient.invalidateQueries({ queryKey: ["convex", "profiles"] });
      setSelectedId(null);
      setCursor(null);
      setHistory([]);
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
          <p className="eyebrow mb-3">Cloud und selbst gehostet</p>
          <div ref={feature.ref} className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-[-0.045em]">Convex</h1>
            {feature.isNew && <NewBadge />}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Teams, Projekte und Deployments.</p>
        </div>
        {selected && (
          <Button variant="outline" size="sm" onClick={() => setAdding((value) => !value)}>
            <Plus className="size-3.5" /> Hinzufügen
          </Button>
        )}
      </header>
      {profiles.isPending ? (
        <p className="text-sm text-muted-foreground">Teams werden geladen…</p>
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
              <h2 className="text-lg font-semibold">Convex verbinden</h2>
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
                      {option ? "Selbst gehostet" : "Cloud"}
                    </button>
                  ))}
                </fieldset>
                {selfHostedFeature.isNew && <NewBadge />}
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {selfHosted
                  ? "Backend-URL (CONVEX_CLOUD_ORIGIN) und einen Admin-Key aus ./generate_admin_key.sh eingeben. l8db speichert den Key im OS-Schlüsselbund."
                  : "Team-ID und Team Access Token aus den Convex-Team-Einstellungen eingeben. l8db speichert den Token im OS-Schlüsselbund."}
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void connect();
                }}
                className="mt-5 flex flex-col gap-3"
              >
                {selfHosted ? (
                  <Input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="Backend-URL, z. B. http://127.0.0.1:3210"
                    aria-label="Convex Backend-URL"
                    autoComplete="off"
                    spellCheck={false}
                    required
                  />
                ) : (
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={teamId}
                    onChange={(event) => setTeamId(event.target.value)}
                    placeholder="Team-ID"
                    aria-label="Convex Team-ID"
                    required
                  />
                )}
                <Input
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder={selfHosted ? "Admin-Key" : "Team Access Token"}
                  aria-label={selfHosted ? "Convex Admin-Key" : "Convex Team Access Token"}
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
                <Button
                  type="submit"
                  disabled={busy || !token || !(selfHosted ? url.trim() : teamId)}
                  className="self-start"
                >
                  {busy ? "Verbinde…" : selfHosted ? "Instanz verbinden" : "Team verbinden"}
                </Button>
              </form>
            </section>
          )}
          {selected && (
            <>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2" role="tablist" aria-label="Convex-Teams">
                  {profiles.data.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={selected.id === item.id}
                      onClick={() => {
                        setSelectedId(item.id);
                        setCursor(null);
                        setHistory([]);
                      }}
                      className={`rounded-xl border px-3 py-2 text-sm transition-colors ${selected.id === item.id ? "border-primary/50 bg-primary/10 text-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
                    >
                      {item.url
                        ? item.url.replace(/^https?:\/\//, "").replace(/\/$/, "")
                        : `Team ${item.team_id}`}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void queryClient.invalidateQueries({ queryKey: ["convex", selected.id] })
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
              {selected.url ? (
                <section
                  data-baas-section="deployments"
                  className="max-w-xl scroll-mt-6 rounded-2xl border bg-card p-5"
                >
                  <div className="flex items-center gap-2">
                    <Server className="size-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold">Selbst gehostetes Deployment</h3>
                  </div>
                  <p
                    className="mt-2 truncate font-mono text-xs text-muted-foreground"
                    title={selected.url}
                  >
                    {selected.url}
                  </p>
                  <ConvexEnvironmentView id={selected.id} projectId={0} deploymentName="" />
                </section>
              ) : projects.isPending ? (
                <p className="text-sm text-muted-foreground">Projekte werden geladen…</p>
              ) : projects.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  {String(projects.error)}
                </p>
              ) : projects.data.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine Projekte vorhanden.</p>
              ) : (
                <div
                  data-baas-section="deployments"
                  className="grid scroll-mt-6 gap-4 lg:grid-cols-2"
                >
                  {projects.data.items.map((project) => (
                    <ConvexProjectView key={project.id} id={selected.id} project={project} />
                  ))}
                </div>
              )}
              {!selected.url &&
                projects.data &&
                (history.length > 0 || projects.data.pagination.hasMore) && (
                  <div className="mt-5 flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={history.length === 0}
                      onClick={() => {
                        const previous = history.at(-1) ?? null;
                        setHistory((items) => items.slice(0, -1));
                        setCursor(previous || null);
                      }}
                    >
                      Zurück
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!projects.data.pagination.nextCursor}
                      onClick={() => {
                        setHistory((items) => [...items, cursor ?? ""]);
                        setCursor(projects.data.pagination.nextCursor);
                      }}
                    >
                      Weiter
                    </Button>
                  </div>
                )}
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
