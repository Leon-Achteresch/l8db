import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpenIcon, GitBranchIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useActiveConnection } from "@/lib/connections";
import { versioningRepository } from "@/lib/db";
import { PROJECT_PATH } from "@/lib/versioning/model";
import { encode, saveFile } from "@/lib/versioning/repository";
import { useVersioning } from "./use-versioning";
import { VersioningDevelopment } from "./versioning-development";
import { VersioningReleases } from "./versioning-releases";
import { VersioningTargets } from "./versioning-targets";

export function VersioningView() {
  const workspace = useVersioning();
  const { repo, status, project, busy, error, message, run, refresh } = workspace;
  const connection = useActiveConnection();
  const [repoInput, setRepoInput] = useState(repo);
  const [tab, setTab] = useState("development");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const initialize = async () => {
    await versioningRepository({ action: "init", repo: repoInput });
    await refresh(repoInput);
  };
  const create = async () => {
    if (!name.trim() || !connection || !["postgres", "oracle"].includes(connection.kind))
      throw new Error("Projektname und eine PostgreSQL- oder Oracle-Verbindung auswählen.");
    await saveFile(
      repo,
      PROJECT_PATH,
      encode({
        format: 1,
        id: crypto.randomUUID(),
        name: name.trim(),
        kind: connection.kind,
        objects: [],
      }),
      null,
    );
    await refresh();
  };
  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-auto p-5"
      aria-label="Datenbank-Versionierung"
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <GitBranchIcon className="size-5 text-indigo-500" />
        <h1 className="text-lg font-semibold">Versionierung</h1>
        <span className="text-sm text-muted-foreground">
          {project?.name ?? "Repository mit Datenbanken verbinden"}
        </span>
        {status && (
          <span className="ml-auto rounded border px-2 py-1 font-mono text-xs">
            {status.branch ?? "Detached HEAD"} · {status.head?.slice(0, 8) ?? "Noch kein Commit"}
          </span>
        )}
      </div>
      <fieldset disabled={busy} className="flex min-h-0 flex-col gap-4 disabled:opacity-70">
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label="Repository-Pfad"
            value={repoInput}
            onChange={(event) => {
              setRepoInput(event.target.value);
            }}
            placeholder="Lokaler Repository-Ordner"
            className="min-w-64 flex-1"
          />
          <Button
            variant="outline"
            aria-label="Repository-Ordner auswählen"
            onClick={() =>
              void run(async () => {
                const path = await open({ directory: true, multiple: false });
                if (path) {
                  setRepoInput(path);
                  await refresh(path);
                }
              })
            }
          >
            <FolderOpenIcon className="size-4" />
          </Button>
          <Button onClick={() => void run(() => refresh(repoInput))}>Repository öffnen</Button>
          <Button variant="outline" onClick={() => void run(initialize)}>
            Git initialisieren
          </Button>
          {status && (
            <Button
              variant="outline"
              aria-label="Versionierung aktualisieren"
              onClick={() => void run(() => refresh())}
            >
              <RefreshCwIcon className="size-4" />
            </Button>
          )}
        </div>
        {error && (
          <div
            role="alert"
            className="whitespace-pre-wrap rounded border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}
        {message && (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        )}
        {status && !project && (
          <div className="flex flex-wrap items-center gap-2 rounded border p-4">
            <Input
              aria-label="Projektname"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Produktname"
            />
            <p className="text-sm text-muted-foreground">
              Datenbanktyp: {connection?.kind ?? "Verbindung auswählen"}
            </p>
            <Button onClick={() => void run(create)}>Versionierungsprojekt anlegen</Button>
          </div>
        )}
        {status && project && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b pb-3">
              <nav className="flex gap-1" aria-label="Versionierungsbereiche">
                {[
                  ["development", "Entwicklung"],
                  ["releases", "Releases"],
                  ["targets", "Kundendatenbanken"],
                ].map(([id, label]) => (
                  <Button
                    key={id}
                    variant={tab === id ? "secondary" : "ghost"}
                    aria-pressed={tab === id}
                    onClick={() => {
                      if (workspace.dirty) {
                        void run(async () => {
                          throw new Error(
                            "Ungespeicherten Entwurf zuerst speichern oder verwerfen.",
                          );
                        });
                      } else setTab(id);
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </nav>
              <select
                aria-label="Git-Branch"
                className="ml-auto rounded border bg-background p-2 text-sm"
                value={status.branch ?? ""}
                onChange={(event) => void run(() => workspace.git("checkout", event.target.value))}
              >
                <option value="" disabled>
                  Branch auswählen
                </option>
                {status.branches.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
              <div className="flex gap-1">
                {(["fetch", "pull", "push"] as const).map((action) => (
                  <Button
                    key={action}
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void run(async () => {
                        if (workspace.dirty)
                          throw new Error(
                            "Ungespeicherten Entwurf zuerst speichern oder verwerfen.",
                          );
                        await versioningRepository({ action, repo });
                        await refresh();
                      }, `Git ${action} abgeschlossen`)
                    }
                  >
                    {action === "fetch" ? "Fetch" : action === "pull" ? "Pull" : "Push"}
                  </Button>
                ))}
              </div>
              <Input
                aria-label="Neuer Branch"
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder="feature/meine-aenderung"
                className="w-52"
              />
              <Button
                variant="outline"
                disabled={!status.head || !branch.trim()}
                onClick={() =>
                  void run(
                    () => workspace.git("branch", branch),
                    "Branch erstellt. Die Datenbanken bleiben unverändert.",
                  )
                }
              >
                Branch erstellen
              </Button>
            </div>
            {tab === "development" && (
              <VersioningDevelopment
                key={`${status.repo}:${project.id}:${status.branch}`}
                workspace={workspace}
              />
            )}
            {tab === "releases" && (
              <VersioningReleases
                key={`${status.repo}:${project.id}:${status.branch}`}
                workspace={workspace}
              />
            )}
            {tab === "targets" && (
              <VersioningTargets key={`${status.repo}:${project.id}`} workspace={workspace} />
            )}
          </>
        )}
      </fieldset>
    </section>
  );
}
