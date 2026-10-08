import { TagIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { relativeTime } from "@/lib/branching/model";
import { versioningRepository } from "@/lib/db";
import { cn } from "@/lib/utils";
import { deployable } from "@/lib/versioning/model";
import {
  type GitGraphCommit,
  graphLanes,
  parseGitGraph,
  targetProgress,
  type VersioningArea,
} from "@/lib/versioning/workflow";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningIconButton } from "./versioning-icon-button";

const ROW = 30;
const LANE = 14;

type HistoryTab = "history" | "releases" | "targets";

export function VersioningHistoryPanel({
  workspace,
  onNavigate,
  onClose,
}: {
  workspace: VersioningWorkspace;
  onNavigate: (area: VersioningArea) => void;
  onClose: () => void;
}) {
  const { repo, status, project, releases, targets } = workspace;
  const [tab, setTab] = useState<HistoryTab>("history");
  const [commits, setCommits] = useState<GitGraphCommit[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!status) return;
    let active = true;
    versioningRepository<string>({ action: "graph", repo })
      .then((text) => {
        if (active) {
          setCommits(parseGitGraph(text));
          setError("");
        }
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [repo, status]);
  if (!status || !project) return null;
  const deploys = deployable(project.kind);
  const rows = graphLanes(commits);
  const width = Math.max(1, ...rows.map((row) => row.width)) * LANE + 8;
  const tabs: { id: HistoryTab; label: string; count?: number }[] = [
    { id: "history", label: "Verlauf" },
    ...(deploys
      ? [
          { id: "releases" as const, label: "Releases", count: releases.length },
          { id: "targets" as const, label: "Kundenstände", count: targets?.targets.length ?? 0 },
        ]
      : []),
  ];
  return (
    <section
      aria-label="Verlauf und Stände"
      className="flex h-64 shrink-0 flex-col border-t border-border/60"
    >
      <div className="flex h-9 shrink-0 items-center gap-1 px-2">
        {tabs.map(({ id, label, count }) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "relative flex h-9 items-center gap-1.5 px-2 text-xs transition-colors",
              tab === id
                ? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
            {Boolean(count) && (
              <span className="text-[10px] text-muted-foreground tabular-nums">{count}</span>
            )}
          </button>
        ))}
        <span className="ml-2 truncate text-[11px] text-muted-foreground">
          {tab === "history"
            ? `${status.branches.length} Branches · letzte ${commits.length} Commits`
            : tab === "releases"
              ? project.name
              : "Ausgelieferter Release je Ziel"}
        </span>
        <VersioningIconButton
          icon={XIcon}
          label="Verlauf ausblenden"
          className="ml-auto size-7"
          onClick={onClose}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain pb-2">
        {tab === "history" && (
          <>
            {error && <p className="px-4 py-2 text-xs text-destructive">{error}</p>}
            {!error && !commits.length && (
              <p className="px-4 py-2 text-xs text-muted-foreground">Noch keine Commits</p>
            )}
            <ol aria-label="Commit-Verlauf">
              {rows.map(({ commit, lane, edges }) => {
                const refs = commit.refs
                  .split(", ")
                  .filter(Boolean)
                  .map((ref) => ref.replace(/^HEAD -> /, ""))
                  .filter((ref) => ref !== "HEAD");
                const x = (index: number) => index * LANE + 10;
                return (
                  <li
                    key={commit.id}
                    className="flex items-center gap-3 pr-4 pl-2 hover:bg-muted/40"
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
                            fill={commit.id === status.head ? "currentColor" : "var(--background)"}
                            stroke="currentColor"
                            strokeWidth="1.5"
                          />
                        </>
                      )}
                    </svg>
                    <span
                      className={cn(
                        "min-w-0 truncate text-xs",
                        commit.id === status.head && "font-medium",
                      )}
                    >
                      {commit.subject}
                    </span>
                    <span className="flex min-w-0 flex-1 gap-1 overflow-hidden">
                      {refs.map((ref) =>
                        ref.startsWith("tag: ") ? (
                          <span
                            key={ref}
                            className="inline-flex shrink-0 items-center gap-1 rounded border border-border px-1.5 font-mono text-[10px] text-muted-foreground"
                          >
                            <TagIcon className="size-2.5" />
                            {ref.slice(5)}
                          </span>
                        ) : (
                          <span
                            key={ref}
                            className="shrink-0 rounded border border-primary/40 px-1.5 font-mono text-[10px] text-primary"
                          >
                            {ref}
                          </span>
                        ),
                      )}
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
                  </li>
                );
              })}
            </ol>
          </>
        )}
        {tab === "releases" && (
          <ul aria-label="Releases">
            {!releases.length && (
              <li className="px-4 py-2 text-xs text-muted-foreground">Noch keine Releases</li>
            )}
            {[...releases].reverse().map((release) => (
              <li key={release.id}>
                <button
                  type="button"
                  onClick={() => onNavigate("releases")}
                  className="flex h-[30px] w-full items-center gap-3 px-4 text-left text-xs hover:bg-muted/40"
                >
                  <TagIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono">{release.id}</span>
                  <span className="w-20 shrink-0 text-[11px] text-muted-foreground">
                    {release.track ?? "main"}
                  </span>
                  <span className="w-28 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                    {release.migrations.length} Migrationen
                  </span>
                  <span className="w-24 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                    {release.objects.length} Objekte
                  </span>
                  <span
                    className="w-24 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums"
                    title={new Date(release.createdAt).toLocaleString()}
                  >
                    {relativeTime(release.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {tab === "targets" && (
          <ul aria-label="Kundenstände">
            {!targets?.targets.length && (
              <li className="px-4 py-2 text-xs text-muted-foreground">Noch keine Kunden</li>
            )}
            {targets?.targets.map((target) => {
              const progress = targetProgress(target, releases, status);
              const last = target.history[0];
              return (
                <li key={target.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate("targets")}
                    className="flex h-[30px] w-full items-center gap-3 px-4 text-left text-xs hover:bg-muted/40"
                  >
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        progress.state === "current"
                          ? "bg-emerald-500"
                          : progress.state === "pending"
                            ? "bg-amber-500"
                            : progress.state === "blocked"
                              ? "bg-destructive"
                              : "bg-muted-foreground/40",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {target.name}
                      {target.customer && (
                        <span className="ml-2 text-[11px] text-muted-foreground">
                          {target.customer}
                        </span>
                      )}
                    </span>
                    <span className="w-32 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
                      {target.release?.id ?? "—"}
                    </span>
                    <span className="w-32 shrink-0 truncate text-[11px] text-muted-foreground">
                      {progress.label}
                    </span>
                    <span className="w-24 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                      {last ? relativeTime(last.startedAt) : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
