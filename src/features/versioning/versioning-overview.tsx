import { useQuery } from "@tanstack/react-query";
import {
  DatabaseIcon,
  FileDiffIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
  ServerIcon,
} from "lucide-react";
import { useMemo } from "react";
import { NewBadge } from "@/components/new-badge";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { providerForKind } from "@/lib/providers";
import { cn } from "@/lib/utils";
import { type ForgeInfo, forge, type PullRequest } from "@/lib/versioning/forge";
import { deployable } from "@/lib/versioning/model";
import { overviewModel } from "@/lib/versioning/overview";
import { CATEGORY_LABELS, findTickets } from "@/lib/versioning/review";
import type { VersioningArea } from "@/lib/versioning/workflow";
import { useTickets } from "./use-tickets";
import type { VersioningWorkspace } from "./use-versioning";
import { CATEGORY_ICONS } from "./versioning-object-kinds";
import { VersioningOverviewCard } from "./versioning-overview-card";
import { VersioningPullState } from "./versioning-pull-state";
import { VersioningTicketChips } from "./versioning-ticket-chips";

export function VersioningOverview({
  workspace,
  pending,
  onNavigate,
}: {
  workspace: VersioningWorkspace;
  pending: number | null;
  onNavigate: (area: VersioningArea) => void;
}) {
  const { repo, project, status, releases, targets } = workspace;
  const feature = useNewFeatureVisibility<HTMLDivElement>("versioning.overview");
  const tickets = useTickets(workspace);
  const model = useMemo(
    () => overviewModel(project, status, releases, targets?.targets ?? [], tickets.configuration),
    [project, status, releases, targets, tickets.configuration],
  );
  const info = useQuery({
    queryKey: ["versioning-forge", repo, "info"],
    retry: false,
    staleTime: 60_000,
    queryFn: () => forge<ForgeInfo>(repo, "info"),
  });
  const pulls = useQuery({
    queryKey: ["versioning-forge", repo, "pulls", "open"],
    enabled: Boolean(info.data?.connected),
    retry: false,
    staleTime: 15_000,
    queryFn: () => forge<PullRequest[]>(repo, "pulls", { state: "open" }),
  });
  if (!project || !status) return null;
  const deploys = deployable(project.kind);
  return (
    <div ref={feature.ref} className="space-y-4">
      <header className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <DatabaseIcon className="size-5" strokeWidth={1.7} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 truncate text-sm font-semibold">
            {project.name}
            {feature.isNew && <NewBadge />}
          </h2>
          <p className="truncate text-[11px] text-muted-foreground">
            {providerForKind(project.kind)?.name ?? project.kind} ·{" "}
            {model.objects.toLocaleString("de-DE")} versionierte Objekte ·{" "}
            <span className="font-mono">{status.branch ?? "Detached HEAD"}</span>
          </p>
        </div>
      </header>
      <ul
        className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2"
        aria-label="Schema"
      >
        {model.schema.map(({ category, count }) => {
          const Icon = CATEGORY_ICONS[category];
          return (
            <li
              key={category}
              className="flex items-center gap-2.5 rounded-xl bg-muted/35 px-3 py-2.5"
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold tabular-nums">
                  {count.toLocaleString("de-DE")}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {CATEGORY_LABELS[category][count === 1 ? 0 : 1]}
                </span>
              </span>
            </li>
          );
        })}
        {!model.schema.length && (
          <li className="col-span-full rounded-xl bg-muted/35 px-3 py-3 text-[11px] text-muted-foreground">
            Noch keine Objekte versioniert. Unter Änderungen die Arbeitskopie prüfen und die Objekte
            committen.
          </li>
        )}
      </ul>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3">
        <VersioningOverviewCard
          icon={FileDiffIcon}
          title="Arbeitskopie"
          action="Änderungen öffnen"
          onOpen={() => onNavigate("development")}
        >
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {pending === null
              ? "Noch nicht geprüft."
              : pending
                ? `${pending} ${pending === 1 ? "Änderung wartet" : "Änderungen warten"} auf den nächsten Commit.`
                : "Datenbank und Repository stimmen überein."}
          </p>
        </VersioningOverviewCard>
        <VersioningOverviewCard
          icon={GitPullRequestIcon}
          title="Offene Pull Requests"
          action="Pull Requests öffnen"
          onOpen={() => onNavigate("reviews")}
        >
          {!info.data?.connected ? (
            <p className="text-[11px] text-muted-foreground">
              {info.data?.remote ? "Git-Plattform noch nicht verbunden." : "Kein Remote „origin“."}
            </p>
          ) : pulls.data?.length ? (
            <ul className="space-y-1.5">
              {pulls.data.slice(0, 4).map((pull) => (
                <li key={pull.number} className="flex min-w-0 items-center gap-2 text-[11px]">
                  <VersioningPullState pull={pull} />
                  <span className="min-w-0 flex-1 truncate">{pull.title}</span>
                  <VersioningTicketChips
                    tickets={findTickets([pull.title, pull.head], tickets.configuration).slice(
                      0,
                      2,
                    )}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {pulls.isLoading ? "Wird geladen…" : "Keine offenen Pull Requests."}
            </p>
          )}
        </VersioningOverviewCard>
        <VersioningOverviewCard
          icon={GitCommitHorizontalIcon}
          title="Letzte Commits"
          action="Verlauf öffnen"
          onOpen={() => onNavigate("history")}
        >
          {model.commits.length ? (
            <ol className="space-y-1.5">
              {model.commits.map((commit) => (
                <li key={commit.hash} className="flex min-w-0 items-center gap-2 text-[11px]">
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {commit.hash.slice(0, 7)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{commit.subject}</span>
                  <VersioningTicketChips tickets={commit.tickets.slice(0, 2)} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[11px] text-muted-foreground">Noch keine Commits unter database/.</p>
          )}
        </VersioningOverviewCard>
        {deploys ? (
          <VersioningOverviewCard
            icon={ServerIcon}
            title="Kunden"
            action="Pipeline öffnen"
            onOpen={() => onNavigate("pipeline")}
          >
            <dl className="grid grid-cols-3 gap-2 text-center">
              {(
                [
                  [model.customers, "Kunden"],
                  [model.pending, "mit Update"],
                  [model.blocked, "zu klären"],
                ] as const
              ).map(([value, label]) => (
                <div key={label} className="rounded-lg bg-muted/35 py-2">
                  <dd
                    className={cn(
                      "text-sm font-semibold tabular-nums",
                      label === "zu klären" && value > 0 && "text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {value}
                  </dd>
                  <dt className="text-[10px] text-muted-foreground">{label}</dt>
                </div>
              ))}
            </dl>
            <p className="text-[11px] text-muted-foreground">
              {model.environments} Umgebungen · neuester Release{" "}
              <span className="font-mono">{model.latest ?? "–"}</span>
            </p>
          </VersioningOverviewCard>
        ) : (
          <VersioningOverviewCard
            icon={GitBranchIcon}
            title="Branches"
            action="Branches öffnen"
            onOpen={() => onNavigate("branches")}
          >
            <p className="text-[11px] text-muted-foreground">
              {model.branches} lokale Branches · aktiv{" "}
              <span className="font-mono">{status.branch ?? "–"}</span>
            </p>
          </VersioningOverviewCard>
        )}
      </div>
    </div>
  );
}
