import { useQuery } from "@tanstack/react-query";
import { ChevronsDownUpIcon, ChevronsUpDownIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { versioningRepository } from "@/lib/db";
import {
  branchChanges,
  commentThreads,
  type PullComment,
  type PullRequest,
} from "@/lib/versioning/forge";
import { CATEGORY_LABELS, groupChanges } from "@/lib/versioning/review";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningIconButton } from "./versioning-icon-button";
import { CATEGORY_ICONS } from "./versioning-object-kinds";
import { VersioningPullObject } from "./versioning-pull-object";

export function VersioningPullChanges({
  workspace,
  pull,
  comments,
  focus,
  onFocus,
  onComment,
  onReply,
}: {
  workspace: VersioningWorkspace;
  pull: PullRequest;
  comments: PullComment[];
  focus: string;
  onFocus: (path: string) => void;
  onComment?: (path: string, line: number, side: "new" | "old", body: string) => Promise<void>;
  onReply?: (thread: PullComment[], body: string) => Promise<void>;
}) {
  const { repo, run, project } = workspace;
  const [all, setAll] = useState(false);
  const changes = useQuery({
    queryKey: ["versioning-forge", repo, "files", pull.number, pull.headSha, pull.mergeSha],
    retry: false,
    queryFn: () =>
      pull.state === "merged" && pull.mergeSha
        ? branchChanges(repo, `${pull.mergeSha}^1`, pull.mergeSha)
        : branchChanges(
            repo,
            `refs/remotes/origin/${pull.base}`,
            pull.headSha ?? `refs/remotes/origin/${pull.head}`,
          ),
  });
  const groups = useMemo(
    () => groupChanges(changes.data?.files ?? [], project),
    [changes.data, project],
  );
  const threads = useMemo(
    () => commentThreads(comments.filter((comment) => comment.path)),
    [comments],
  );
  const threadsFor = (path: string) => threads.filter((thread) => thread[0].path === path);
  if (changes.isLoading) return <Skeleton className="h-32 rounded-lg" />;
  if (changes.error)
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted/30 p-3 text-[11px] text-muted-foreground">
        <span className="flex-1">
          Der Stand des Pull Requests ist lokal noch nicht vorhanden. Zuerst abrufen.
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          onClick={() =>
            void run(async () => {
              await versioningRepository({ action: "fetch", repo });
              await changes.refetch();
            })
          }
        >
          Abrufen
        </Button>
      </div>
    );
  if (!changes.data?.files.length)
    return <p className="text-[11px] text-muted-foreground">Keine Änderungen unter database/.</p>;
  const data = changes.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {groups.map((group) => {
          const Icon = CATEGORY_ICONS[group.category];
          return (
            <span
              key={group.category}
              className="flex items-center gap-1 rounded-md bg-muted/40 px-2 py-1 text-[10px]"
            >
              <Icon className="size-3 text-muted-foreground" strokeWidth={1.7} />
              {group.entries.length}{" "}
              {CATEGORY_LABELS[group.category][group.entries.length === 1 ? 0 : 1]}
            </span>
          );
        })}
        <VersioningIconButton
          icon={all ? ChevronsDownUpIcon : ChevronsUpDownIcon}
          label={all ? "Alle Objekte zuklappen" : "Alle Objekte aufklappen"}
          className="ml-auto size-7"
          onClick={() => setAll(!all)}
        />
      </div>
      {groups.map((group) => {
        const Icon = CATEGORY_ICONS[group.category];
        return (
          <section key={group.category} className="space-y-0.5">
            <h4 className="flex items-center gap-1.5 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Icon className="size-3" strokeWidth={1.7} />
              {CATEGORY_LABELS[group.category][1]}
            </h4>
            {group.entries.map((entry) => (
              <VersioningPullObject
                key={entry.path}
                repo={repo}
                entry={entry}
                base={data.base}
                head={data.head}
                threads={threadsFor(entry.path)}
                expanded={all || focus === entry.path}
                onToggle={() => onFocus(focus === entry.path ? "" : entry.path)}
                onComment={
                  onComment
                    ? (line, side, body) => onComment(entry.path, line, side, body)
                    : undefined
                }
                onReply={onReply}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}
