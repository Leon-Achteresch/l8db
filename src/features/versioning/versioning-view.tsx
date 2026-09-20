import {
  ArrowDownIcon,
  ArrowDownUpIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  FileDiffIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  HistoryIcon,
  PlusIcon,
  RefreshCwIcon,
  ServerIcon,
  TagIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveConnection } from "@/lib/connections";
import { versioningRepository } from "@/lib/db";
import { PROJECT_PATH } from "@/lib/versioning/model";
import { useVersioningPanel } from "@/lib/versioning/panel";
import { encode, saveFile } from "@/lib/versioning/repository";
import { changedFiles } from "@/lib/versioning/status";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningActivity } from "./versioning-activity";
import { VersioningDevelopment } from "./versioning-development";
import { VersioningIconButton } from "./versioning-icon-button";
import { VersioningPopover } from "./versioning-popover";
import { VersioningReleases } from "./versioning-releases";
import { VersioningRepositoryPopover } from "./versioning-repository-popover";
import { VersioningSelect } from "./versioning-select";
import { VersioningTargets } from "./versioning-targets";
import "./versioning.css";

export function VersioningView({ workspace }: { workspace: VersioningWorkspace }) {
  const { repo, status, project, busy, error, message, run, refresh } = workspace;
  const connection = useActiveConnection();
  const [tab, setTab] = useState("development");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const count = changedFiles(status?.changes ?? "").size;
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
      className="vcs-surface flex h-full min-h-0 flex-col"
      aria-label="Datenbank-Versionierung"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 px-4">
        <GitPullRequestIcon className="size-4 text-primary" strokeWidth={1.7} />
        <h1 className="flex-1 text-xs font-semibold">Versionierung</h1>
        {status && <VersioningRepositoryPopover workspace={workspace} />}
        <VersioningIconButton
          icon={RefreshCwIcon}
          label="Versionierung aktualisieren"
          disabled={busy || !repo}
          className={busy ? "animate-pulse" : ""}
          onClick={() => void run(() => refresh())}
        />
        <VersioningIconButton
          icon={XIcon}
          label="Versionierung schließen"
          onClick={() => useVersioningPanel.getState().setOpen(false)}
        />
      </header>
      {error && (
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
          <div className="space-y-2">
            <h2 className="text-base font-semibold tracking-tight">
              Ein Zuhause für deine Datenbank
            </h2>
            <p className="max-w-72 text-xs leading-relaxed text-muted-foreground">
              Definitionen vergleichen, Änderungen versionieren und Kundenstände gemeinsam
              verwalten.
            </p>
          </div>
          <VersioningRepositoryPopover workspace={workspace} initial />
        </div>
      ) : !project ? (
        <fieldset disabled={busy} className="mx-5 mt-8 flex flex-col gap-4">
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
            {connection?.kind ?? "PostgreSQL oder Oracle"}
          </p>
          <Button size="sm" onClick={() => void run(create)}>
            Versionierungsprojekt anlegen
          </Button>
        </fieldset>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2 px-5 pb-4 pt-2">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-semibold tracking-tight">{project.name}</h2>
              <p title={repo} className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {repo.split(/[\\/]/).filter(Boolean).at(-1)}{" "}
                <span className="mx-1 opacity-50">/</span>{" "}
                {project.kind === "oracle" ? "Oracle" : "PostgreSQL"}
              </p>
            </div>
            <VersioningPopover
              icon={GitBranchIcon}
              label="Branches"
              disabled={busy}
              trigger={
                <button
                  type="button"
                  disabled={busy}
                  className="inline-flex max-w-44 items-center gap-1.5 rounded-lg bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground hover:bg-muted"
                >
                  <GitBranchIcon className="size-3.5 shrink-0" />
                  <span className="truncate font-mono">{status.branch ?? "Detached HEAD"}</span>
                  <ChevronDownIcon className="size-3 shrink-0" />
                </button>
              }
            >
              <VersioningSelect
                label="Git-Branch"
                value={status.branch ?? ""}
                onChange={(value) => void run(() => workspace.git("checkout", value))}
                options={status.branches.map((value) => ({ value, label: value }))}
              />
              <div className="mt-1 space-y-2">
                <label className="text-xs font-medium" htmlFor="vcs-new-branch">
                  Neuen Branch anlegen
                </label>
                <Input
                  id="vcs-new-branch"
                  aria-label="Neuer Branch"
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                  placeholder="feature/meine-aenderung"
                />
                <Button
                  size="sm"
                  className="w-full"
                  disabled={!status.head || !branch.trim()}
                  onClick={() => void run(() => workspace.git("branch", branch), "Branch erstellt")}
                >
                  <PlusIcon className="size-3.5" />
                  Branch erstellen
                </Button>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">
                {status.head?.slice(0, 8) ?? "Noch kein Commit"}
              </span>
            </VersioningPopover>
            <VersioningPopover icon={ArrowDownUpIcon} label="Git synchronisieren" disabled={busy}>
              {(
                [
                  {
                    action: "fetch",
                    label: "Fetch",
                    description: "Remote-Stand abrufen",
                    icon: RefreshCwIcon,
                  },
                  {
                    action: "pull",
                    label: "Pull",
                    description: "Lokalen Branch aktualisieren",
                    icon: ArrowDownIcon,
                  },
                  {
                    action: "push",
                    label: "Push",
                    description: "Commits veröffentlichen",
                    icon: ArrowUpIcon,
                  },
                ] as const
              ).map(({ action, label, description, icon: Icon }) => (
                <button
                  key={action}
                  type="button"
                  className="flex items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted"
                  onClick={() =>
                    void run(async () => {
                      if (workspace.dirty)
                        throw new Error("Ungespeicherten Entwurf zuerst speichern oder verwerfen.");
                      await versioningRepository({ action, repo });
                      await refresh();
                    }, `Git ${action} abgeschlossen`)
                  }
                >
                  <Icon className="size-4 text-muted-foreground" />
                  <span className="text-xs font-medium">
                    {label}
                    <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                      {description}
                    </span>
                  </span>
                </button>
              ))}
            </VersioningPopover>
          </div>
          <Tabs
            value={tab}
            onValueChange={(next) => {
              if (next === tab) return;
              if (workspace.dirty)
                void run(async () => {
                  throw new Error("Ungespeicherten Entwurf zuerst speichern oder verwerfen.");
                });
              else setTab(next);
            }}
            className="min-h-0 flex-1 gap-0"
          >
            <TabsList
              variant="line"
              aria-label="Versionierungsbereiche"
              className="mx-4 h-10 w-auto shrink-0 justify-start gap-1 border-b border-border/50 px-0"
            >
              {[
                { id: "development", label: "Änderungen", icon: FileDiffIcon, count },
                { id: "releases", label: "Releases", icon: TagIcon },
                { id: "targets", label: "Datenbanken", icon: ServerIcon },
                { id: "activity", label: "Aktivität", icon: HistoryIcon },
              ].map(({ id, label, icon: Icon, count: badge }) => (
                <TabsTrigger
                  key={id}
                  value={id}
                  disabled={busy}
                  className="relative h-10 flex-none gap-1.5 rounded-none border-0 px-2.5 text-xs shadow-none data-[state=active]:text-foreground data-[state=active]:after:opacity-100 data-[state=active]:after:bg-primary data-[state=inactive]:text-muted-foreground"
                >
                  <Icon className="size-3.5" />
                  {label}
                  {Boolean(badge) && (
                    <span className="ml-0.5 font-mono text-[10px] text-muted-foreground">
                      {badge}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-4">
              <fieldset disabled={busy} className="min-w-0">
                <TabsContent value="development" className="m-0">
                  <VersioningDevelopment
                    key={`${status.repo}:${project.id}:${status.branch}`}
                    workspace={workspace}
                  />
                </TabsContent>
                <TabsContent value="releases" className="m-0">
                  <VersioningReleases
                    key={`${status.repo}:${project.id}:${status.branch}`}
                    workspace={workspace}
                  />
                </TabsContent>
                <TabsContent value="targets" className="m-0">
                  <VersioningTargets key={`${status.repo}:${project.id}`} workspace={workspace} />
                </TabsContent>
                <TabsContent value="activity" className="m-0">
                  <VersioningActivity workspace={workspace} />
                </TabsContent>
              </fieldset>
            </div>
          </Tabs>
        </>
      )}
      {message && (
        <p
          role="status"
          className="shrink-0 truncate px-5 py-2 text-[10px] text-muted-foreground"
          title={message}
        >
          {message}
        </p>
      )}
    </section>
  );
}
