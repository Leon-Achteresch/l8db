import { CopyIcon, RocketIcon, TagIcon, Undo2Icon } from "lucide-react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { relativeTime } from "@/lib/branching/model";
import { cn } from "@/lib/utils";
import { STAGE_LABELS } from "@/lib/versioning/delivery";
import type { CommitMarks } from "@/lib/versioning/history";
import type { DatabaseRelease, TargetStage } from "@/lib/versioning/types";
import type { GitGraphCommit, graphLanes } from "@/lib/versioning/workflow";

const ROW = 30;
const LANE = 14;
const STAGES: TargetStage[] = ["development", "test", "production"];

export function VersioningHistoryRow({
  row: { commit, lane, edges },
  width,
  head,
  marks,
  canRollback,
  onOpen,
  onRollout,
}: {
  row: ReturnType<typeof graphLanes>[number];
  width: number;
  head: string | null;
  marks?: CommitMarks;
  canRollback: (release: DatabaseRelease) => boolean;
  onOpen?: (release: DatabaseRelease) => void;
  onRollout?: (release: DatabaseRelease) => void;
}) {
  const refs = commit.refs
    .split(", ")
    .filter(Boolean)
    .map((ref) => ref.replace(/^HEAD -> /, ""))
    .filter((ref) => ref !== "HEAD" && !ref.startsWith("tag: "));
  const tags = commit.refs
    .split(", ")
    .filter((ref) => ref.startsWith("tag: "))
    .map((ref) => ref.slice(5));
  const releases = marks?.releases ?? [];
  const x = (index: number) => index * LANE + 10;
  const copy = (commit: GitGraphCommit) =>
    void navigator.clipboard
      .writeText(commit.id)
      .then(() => toast.success("Commit-Hash kopiert"))
      .catch((cause) => toast.error(String(cause)));
  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            onClick={releases[0] && onOpen ? () => onOpen(releases[0]) : undefined}
            className={cn(
              "flex w-full items-center gap-3 pr-4 pl-2 text-left hover:bg-muted/40 focus-visible:bg-muted/60 focus-visible:outline-none data-[state=open]:bg-muted/60",
              !releases.length && "cursor-default",
            )}
            style={{ height: ROW }}
          >
            <svg
              width={width}
              height={ROW}
              viewBox={`0 0 ${width} ${ROW}`}
              className="shrink-0 text-primary"
              aria-hidden="true"
            >
              {edges.map((edge) => (
                <path
                  key={`${edge.from}:${edge.parent}`}
                  d={`M ${x(edge.from)} ${edge.active ? ROW / 2 : 0} C ${x(edge.from)} ${ROW * 0.8}, ${x(edge.to)} ${ROW * 0.8}, ${x(edge.to)} ${ROW}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  opacity={edge.active ? 0.85 : 0.35}
                />
              ))}
              {lane >= 0 && (
                <>
                  <path
                    d={`M ${x(lane)} 0 V ${ROW / 2}`}
                    stroke="currentColor"
                    strokeWidth="1.5"
                    opacity="0.6"
                  />
                  <circle
                    cx={x(lane)}
                    cy={ROW / 2}
                    r={commit.parents.length > 1 ? 4.5 : 3.5}
                    fill={commit.id === head ? "currentColor" : "var(--background)"}
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </>
              )}
            </svg>
            <span className={cn("min-w-0 truncate text-xs", commit.id === head && "font-medium")}>
              {commit.subject}
            </span>
            <span className="flex min-w-0 flex-1 gap-1 overflow-hidden">
              {releases.map((release) => (
                <span
                  key={release.id}
                  title={`Release ${release.id}${release.track ? ` · Linie ${release.track}` : ""}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded bg-primary/10 px-1.5 font-mono text-[10px] font-medium text-primary"
                >
                  <TagIcon className="size-2.5" />
                  {release.id}
                </span>
              ))}
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex shrink-0 items-center gap-1 rounded border border-border px-1.5 font-mono text-[10px] text-muted-foreground"
                >
                  <TagIcon className="size-2.5" />
                  {tag}
                </span>
              ))}
              {refs.map((ref) => (
                <span
                  key={ref}
                  className="shrink-0 rounded border border-primary/40 px-1.5 font-mono text-[10px] text-primary"
                >
                  {ref}
                </span>
              ))}
              {marks &&
                STAGES.map((stage) => {
                  const targets = marks.deployed[stage];
                  if (!targets.length) return null;
                  const names = targets.map((target) => target.customer ?? target.name);
                  return (
                    <span
                      key={stage}
                      title={`Ausgerollt auf ${STAGE_LABELS[stage]}: ${names.join(", ")}`}
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded border px-1.5 text-[10px]",
                        stage === "production"
                          ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          stage === "production"
                            ? "bg-emerald-500"
                            : stage === "test"
                              ? "bg-sky-500"
                              : "bg-muted-foreground/50",
                        )}
                      />
                      {STAGE_LABELS[stage]}
                      {targets.length === 1 ? ` · ${names[0]}` : ` ${targets.length}`}
                    </span>
                  );
                })}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {commit.id.slice(0, 7)}
            </span>
            <span
              className="w-24 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums"
              title={new Date(commit.date).toLocaleString()}
            >
              {relativeTime(commit.date)}
            </span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {releases.map((release) => (
            <div key={release.id}>
              {onOpen && (
                <ContextMenuItem onSelect={() => onOpen(release)}>
                  <TagIcon />
                  Release {release.id} anzeigen
                </ContextMenuItem>
              )}
              {onRollout && (
                <ContextMenuItem onSelect={() => onRollout(release)}>
                  <RocketIcon />
                  {release.id} ausrollen…
                </ContextMenuItem>
              )}
              {onOpen && canRollback(release) && (
                <ContextMenuItem onSelect={() => onOpen(release)}>
                  <Undo2Icon />
                  Auf {release.id} zurücknehmen…
                </ContextMenuItem>
              )}
              <ContextMenuSeparator />
            </div>
          ))}
          <ContextMenuItem onSelect={() => copy(commit)}>
            <CopyIcon />
            Commit-Hash kopieren
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </li>
  );
}
