import { useEffect, useMemo, useState } from "react";
import { versioningRepository } from "@/lib/db";
import { historyMarks, parseReleaseCommits } from "@/lib/versioning/history";
import { deployable } from "@/lib/versioning/model";
import { rollbackBases } from "@/lib/versioning/rollback";
import {
  type GitGraphCommit,
  graphLanes,
  parseGitGraph,
  type VersioningArea,
} from "@/lib/versioning/workflow";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningHistoryRow } from "./versioning-history-row";

const LANE = 14;

export function VersioningHistoryPanel({
  workspace,
  onNavigate,
}: {
  workspace: VersioningWorkspace;
  onNavigate: (area: VersioningArea) => void;
}) {
  const { repo, status, project, releases, targets } = workspace;
  const [commits, setCommits] = useState<GitGraphCommit[]>([]);
  const [releaseCommits, setReleaseCommits] = useState(new Map<string, string>());
  const [error, setError] = useState("");
  const key = status ? `${status.head}\0${status.branches.join("\0")}` : "";
  useEffect(() => {
    if (!key) return;
    let active = true;
    Promise.all([
      versioningRepository<string>({ action: "graph", repo }),
      versioningRepository<string>({ action: "release-commits", repo }),
    ])
      .then(([graph, added]) => {
        if (!active) return;
        setCommits(parseGitGraph(graph));
        setReleaseCommits(parseReleaseCommits(added));
        setError("");
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [repo, key]);
  const marks = useMemo(
    () => historyMarks(releases, targets?.targets ?? [], releaseCommits),
    [releases, targets, releaseCommits],
  );
  const rows = useMemo(() => graphLanes(commits), [commits]);
  if (!status || !project) return null;
  const deploys = deployable(project.kind);
  const width = Math.max(1, ...rows.map((row) => row.width)) * LANE + 8;
  const open = (id: string) => {
    workspace.setRequestedRollbackId(id);
    onNavigate("releases");
  };
  return (
    <section aria-label="Verlauf" className="flex min-h-0 flex-1 flex-col">
      <p className="flex h-9 shrink-0 items-center px-4 text-[11px] text-muted-foreground">
        {status.branches.length} Branches · letzte {commits.length} Commits
        {deploys && " · Rechtsklick auf einen Release-Commit zum Ausrollen oder Zurücknehmen"}
      </p>
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain pb-2">
        {error && <p className="px-4 py-2 text-xs text-destructive">{error}</p>}
        {!error && !commits.length && (
          <p className="px-4 py-2 text-xs text-muted-foreground">Noch keine Commits</p>
        )}
        <ol aria-label="Commit-Verlauf">
          {rows.map((row) => (
            <VersioningHistoryRow
              key={row.commit.id}
              row={row}
              width={width}
              head={status.head}
              marks={marks.get(row.commit.id)}
              canRollback={(release) => rollbackBases(releases, release).length > 0}
              onOpen={deploys ? (release) => open(release.id) : undefined}
              onRollout={
                deploys
                  ? (release) => {
                      workspace.setRequestedReleaseId(release.id);
                      onNavigate("targets");
                    }
                  : undefined
              }
            />
          ))}
        </ol>
      </div>
    </section>
  );
}
