import { GitBranchIcon, GitMergeIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { versioningRepository } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { type GitGraphCommit, graphLanes, parseGitGraph } from "@/lib/versioning/workflow";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningSelect } from "./versioning-select";

export function VersioningBranches({ workspace }: { workspace: VersioningWorkspace }) {
  const feature = useNewFeatureVisibility<HTMLElement>("versioning.branches.swimlanes");
  const [name, setName] = useState("");
  const [incoming, setIncoming] = useState("");
  const [base, setBase] = useState("");
  const [commits, setCommits] = useState<GitGraphCommit[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { repo, status, busy, run, refresh } = workspace;
  useEffect(() => {
    if (!status) return;
    let active = true;
    setLoading(true);
    setError("");
    versioningRepository<string>({ action: "graph", repo })
      .then((text) => {
        if (active) setCommits(parseGitGraph(text));
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [repo, status]);
  if (!status) return null;
  const rows = graphLanes(commits);
  const width = Math.max(1, ...rows.map((row) => row.width)) * 20 + 12;
  return (
    <section ref={feature.ref} className="space-y-5" aria-label="Git-Branches und Swimlanes">
      <div className="flex items-center gap-2">
        <GitBranchIcon className="size-4 text-primary" />
        <h2 className="flex-1 text-sm font-semibold">Branches</h2>
        {feature.isNew && <NewBadge />}
        <span className="font-mono text-[11px] text-muted-foreground">
          {status.branches.length} lokal
        </span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Jeder Branch verwaltet Schema, Migrationen und Seeds in Git. Für Datenbankänderungen eine
        eigene Development-Umgebung zuordnen.
      </p>
      <VersioningSelect
        label="Aktiver Branch"
        value={status.branch ?? ""}
        onChange={(value) => void run(() => workspace.git("checkout", value), "Branch gewechselt")}
        options={status.branches.map((value) => ({ value, label: value }))}
      />
      <VersioningSelect
        label="Development-Ziel dieses Branches"
        value={workspace.branchTargetId}
        onChange={workspace.setBranchTargetId}
        placeholder="Eigene Entwicklungsumgebung zuordnen"
        options={(workspace.targets?.targets ?? [])
          .filter((target) => !target.production)
          .map((target) => ({
            value: target.id,
            label: `${target.name} · ${target.database ?? "Datenbank"} / ${target.schema}`,
          }))}
      />
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Der Branchwechsel verändert nur Git-Dateien. Diese lokale Zuordnung wählt die isolierte
        Datenbank für Schema-Vergleich und Seeds.
      </p>
      <div className="flex items-end gap-2">
        <label
          htmlFor="vcs-create-branch"
          className="min-w-0 flex-1 space-y-1.5 text-xs font-medium"
        >
          Neuer Branch
          <Input
            id="vcs-create-branch"
            aria-label="Branchname"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="feature/kundenportal"
          />
        </label>
        <Button
          size="sm"
          disabled={busy || !status.head || !name.trim()}
          onClick={() =>
            void run(async () => {
              await workspace.git(
                "branch",
                name.trim(),
                undefined,
                base ? `refs/heads/${base}` : undefined,
              );
              setName("");
            }, "Branch angelegt und ausgecheckt")
          }
        >
          <PlusIcon className="size-3.5" />
          Anlegen
        </Button>
      </div>
      <VersioningSelect
        label="Basis für den neuen Branch"
        value={base || status.branch || ""}
        onChange={setBase}
        options={status.branches.map((value) => ({ value, label: value }))}
      />
      <details className="rounded-lg bg-muted/25 p-3">
        <summary className="cursor-pointer text-xs font-medium">Branch zusammenführen</summary>
        <div className="mt-3 space-y-3">
          <VersioningSelect
            label="Branch zum Zusammenführen"
            value={incoming}
            onChange={setIncoming}
            placeholder="Quell-Branch wählen"
            options={status.branches
              .filter((branch) => branch !== status.branch)
              .map((value) => ({ value, label: value }))}
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Übernimmt alle Änderungen aus dem gewählten Branch nach {status.branch ?? "HEAD"}. Bei
            Konflikten wird der Merge abgebrochen; einzelne Dateien lassen sich unter Änderungen
            zusammenführen.
          </p>
          <Button
            size="sm"
            disabled={!incoming || busy || workspace.dirty}
            onClick={() =>
              void run(async () => {
                await versioningRepository({ action: "merge-branch", repo, name: incoming });
                await refresh();
              }, "Branches zusammengeführt")
            }
          >
            <GitMergeIcon className="size-3.5" />
            In {status.branch} zusammenführen
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!incoming || busy || workspace.dirty}
            onClick={() =>
              void run(async () => {
                await versioningRepository({ action: "delete-branch", repo, name: incoming });
                setIncoming("");
                await refresh();
              }, "Zusammengeführten Branch gelöscht")
            }
          >
            Zusammengeführten Branch löschen
          </Button>
        </div>
      </details>
      <div>
        <h3 className="text-xs font-semibold">Git-Verlauf · Swimlanes</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Alle lokalen und abgerufenen Remote-Branches · letzte 120 Commits
        </p>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {loading && (
        <p role="status" className="text-xs text-muted-foreground">
          Git-Verlauf laden…
        </p>
      )}
      {!loading && !commits.length && (
        <p className="py-5 text-xs text-muted-foreground">
          Mit dem ersten Commit beginnt der Verlauf.
        </p>
      )}
      <ol className="overflow-x-auto" aria-label="Commit-Swimlanes">
        {rows.map(({ commit, lane, edges }) => (
          <li key={commit.id} className="flex h-20 min-w-max items-stretch gap-3">
            <svg
              width={width}
              height={80}
              viewBox={`0 0 ${width} 80`}
              className="shrink-0 text-primary"
              aria-hidden="true"
            >
              {edges.map((edge) => (
                <path
                  key={`${edge.from}:${edge.parent}`}
                  d={`M ${edge.from * 20 + 12} ${edge.active ? 24 : 0} C ${edge.from * 20 + 12} 44, ${edge.to * 20 + 12} 44, ${edge.to * 20 + 12} 80`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  opacity={edge.active ? 0.85 : 0.3}
                />
              ))}
              {lane >= 0 && (
                <>
                  <path d={`M ${lane * 20 + 12} 0 V 24`} stroke="currentColor" opacity="0.5" />
                  <circle
                    cx={lane * 20 + 12}
                    cy={24}
                    r={commit.parents.length > 1 ? 5 : 4}
                    fill={commit.id === status.head ? "currentColor" : "var(--background)"}
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </>
              )}
            </svg>
            <div className="min-w-0 max-w-lg flex-1 py-2">
              <div className="flex gap-1.5 overflow-hidden">
                {commit.refs
                  .split(", ")
                  .filter(Boolean)
                  .map((ref) => (
                    <span
                      key={ref}
                      className="rounded bg-primary/8 px-1.5 py-0.5 font-mono text-[10px] text-primary"
                    >
                      {ref}
                    </span>
                  ))}
              </div>
              <p className="mt-1 max-w-lg truncate text-xs font-medium">{commit.subject}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                <span className="font-mono">{commit.id.slice(0, 8)}</span> ·{" "}
                {new Date(commit.date).toLocaleString()}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
