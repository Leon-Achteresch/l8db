import { CircleAlertIcon, GitBranchIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useActiveConnection } from "@/lib/connections";
import { providerForKind } from "@/lib/providers";
import { isVersioningKind, PROJECT_PATH } from "@/lib/versioning/model";
import { useVersioningPanel } from "@/lib/versioning/panel";
import { encode, saveFile } from "@/lib/versioning/repository";
import { changedFiles } from "@/lib/versioning/status";
import type { VersioningArea } from "@/lib/versioning/workflow";
import { DatabaseVersioning } from "./database/database-versioning";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningAreaSwitch } from "./versioning-area-switch";
import { VersioningGit } from "./versioning-git";
import { VersioningHeader } from "./versioning-header";
import { VersioningRepositoryPopover } from "./versioning-repository-popover";
import "./versioning.css";

const AREA_KEY = "l8db.versioning.area";

export function VersioningView({ workspace }: { workspace: VersioningWorkspace }) {
  const { repo, status, project, busy, error, message, run, refresh } = workspace;
  const connection = useActiveConnection();
  const [tab, setTab] = useState<VersioningArea>("pipeline");
  const wide = useVersioningPanel((state) => state.mode === "tab");
  const [area, setArea] = useState<"database" | "git">(() =>
    localStorage.getItem(AREA_KEY) === "database" ? "database" : "git",
  );
  const blocked = () =>
    void run(async () => {
      throw new Error("Ungespeicherten Entwurf zuerst speichern oder verwerfen.");
    });
  const switchArea = (next: "database" | "git") => {
    if (next === area) return;
    if (workspace.dirty) blocked();
    else {
      localStorage.setItem(AREA_KEY, next);
      setArea(next);
    }
  };
  const changeArea = (next: VersioningArea) => {
    if (next === tab) return;
    if (workspace.dirty) blocked();
    else setTab(next);
  };
  const [name, setName] = useState("");
  const count = changedFiles(status?.changes ?? "").size;
  const workbench = area === "git" && Boolean(status && project);
  const create = async () => {
    if (!name.trim() || !connection || !isVersioningKind(connection.kind))
      throw new Error("Projektname und eine SQL-Verbindung auswählen.");
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
      className="vcs-surface flex h-full min-h-0 flex-col"
      aria-label="Datenbank-Versionierung"
    >
      {!workbench && (
        <>
          <VersioningHeader workspace={workspace} area={area} />
          <VersioningAreaSwitch area={area} onChange={switchArea} count={count} />
        </>
      )}
      {area === "database" ? (
        <DatabaseVersioning />
      ) : (
        <>
          {error && !workbench && (
            <div
              role="alert"
              className="mx-4 mb-3 flex gap-2 rounded-lg bg-destructive/5 p-3 text-xs leading-relaxed text-destructive"
            >
              <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{error.replace(/^Error: /, "")}</span>
            </div>
          )}
          {!status ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-10 pb-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-muted/50">
                <GitBranchIcon className="size-6 text-muted-foreground" strokeWidth={1.4} />
              </div>
              <h2 className="text-sm font-semibold tracking-tight">Kein Repository verbunden</h2>
              <VersioningRepositoryPopover workspace={workspace} initial />
            </div>
          ) : !project ? (
            <fieldset disabled={busy} className="mx-5 mt-8 flex max-w-md flex-col gap-4">
              <div>
                <p className="mb-1 text-[11px] text-muted-foreground">Repository verbunden</p>
                <h2 className="text-base font-semibold">Datenbankprojekt einrichten</h2>
              </div>
              <Input
                aria-label="Projektname"
                placeholder="Projektname"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {connection?.name ?? "Verbindung auswählen"} ·{" "}
                {connection ? (providerForKind(connection.kind)?.name ?? connection.kind) : "SQL"}
              </p>
              {connection && !isVersioningKind(connection.kind) && (
                <p className="text-xs text-destructive">
                  Git-Versionierung unterstützt PostgreSQL, Oracle, MySQL, SQL Server, SQLite,
                  DuckDB und ClickHouse.
                </p>
              )}
              <Button size="sm" onClick={() => void run(create)}>
                Versionierungsprojekt anlegen
              </Button>
            </fieldset>
          ) : (
            <VersioningGit
              key={`${status.repo}:${project.id}:${status.branch}`}
              workspace={workspace}
              wide={wide}
              section={tab}
              onNavigate={changeArea}
              area={area}
              onArea={switchArea}
            />
          )}
          {message && !workbench && (
            <p
              role="status"
              className="shrink-0 truncate px-5 py-2 text-[10px] text-muted-foreground"
              title={message}
            >
              {message}
            </p>
          )}
        </>
      )}
    </section>
  );
}
