import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { versioningRepository } from "@/lib/db";
import { errorMessageOf } from "@/lib/error-details";
import { historyMarks, parseReleaseCommits } from "@/lib/versioning/history";
import { deployable } from "@/lib/versioning/model";
import { findTickets } from "@/lib/versioning/review";
import { rollbackBases } from "@/lib/versioning/rollback";
import {
  type GitGraphCommit,
  graphLanes,
  parseGitGraph,
  type VersioningArea,
} from "@/lib/versioning/workflow";
import { useTickets } from "./use-tickets";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningCommitDetails } from "./versioning-commit-details";
import { VersioningHistoryRow } from "./versioning-history-row";

const LANE = 14;
const PAGE = 120;

export function VersioningHistoryPanel({
  workspace,
  onNavigate,
}: {
  workspace: VersioningWorkspace;
  onNavigate: (area: VersioningArea) => void;
}) {
  const { repo, status, project, releases, targets } = workspace;
  const tickets = useTickets(workspace);
  const [commits, setCommits] = useState<GitGraphCommit[]>([]);
  const [releaseCommits, setReleaseCommits] = useState(new Map<string, string>());
  const [error, setError] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<string | null>(null);
  const key = status ? `${status.head}\0${status.branches.join("\0")}` : "";
  useEffect(() => {
    if (!key) return;
    let active = true;
    Promise.all([
      versioningRepository<string>({ action: "graph", repo, limit }),
      versioningRepository<string>({ action: "release-commits", repo }),
    ])
      .then(([graph, added]) => {
        if (!active) return;
        setCommits(parseGitGraph(graph));
        setReleaseCommits(parseReleaseCommits(added));
        setError("");
      })
      .catch((cause) => {
        if (active) setError(errorMessageOf(cause));
      });
    return () => {
      active = false;
    };
  }, [repo, key, limit]);
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
    <section aria-label="Verlauf" className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <p className="flex h-9 shrink-0 items-center px-4 text-[11px] text-muted-foreground tabular-nums">
          {status.branches.length} Branches · {commits.length} Commits
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
                selected={row.commit.id === selected}
                onSelect={() =>
                  setSelected((current) => (current === row.commit.id ? null : row.commit.id))
                }
                marks={marks.get(row.commit.id)}
                tickets={findTickets([row.commit.subject], tickets.configuration)}
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
          {commits.length >= limit && limit < 5000 && (
            <div className="px-4 py-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setLimit((current) => Math.min(5000, current + PAGE))}
              >
                Ältere Commits laden
              </Button>
            </div>
          )}
        </div>
      </div>
      {selected && (
        <VersioningCommitDetails
          repo={repo}
          commitId={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
