import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitPullRequestIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";
import { type ForgeInfo, forge, type PullRequest } from "@/lib/versioning/forge";
import { findTickets } from "@/lib/versioning/review";
import { useTickets } from "./use-tickets";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningForgeAccount } from "./versioning-forge-account";
import { VersioningForgeConnect } from "./versioning-forge-connect";
import { VersioningIconButton } from "./versioning-icon-button";
import { VersioningPullCreate } from "./versioning-pull-create";
import { VersioningPullPage } from "./versioning-pull-page";
import { VersioningPullRow } from "./versioning-pull-row";
import { VersioningTicketSettings } from "./versioning-ticket-settings";

const FILTERS = [
  ["open", "Offen"],
  ["merged", "Gemergt"],
  ["closed", "Geschlossen"],
] as const;

type PullState = (typeof FILTERS)[number][0];

export function VersioningReviews({ workspace }: { workspace: VersioningWorkspace }) {
  const feature = useNewFeatureVisibility<HTMLElement>("versioning.reviews");
  const conversation = useNewFeatureVisibility<HTMLDivElement>("versioning.reviews.conversation");
  const { repo } = workspace;
  const queryClient = useQueryClient();
  const tickets = useTickets(workspace);
  const [state, setState] = useState<PullState>("open");
  const [selected, setSelected] = useState<PullRequest | null>(null);
  const [search, setSearch] = useState("");
  const info = useQuery({
    queryKey: ["versioning-forge", repo, "info"],
    retry: false,
    staleTime: 60_000,
    queryFn: () => forge<ForgeInfo>(repo, "info"),
  });
  const connected = Boolean(info.data?.connected);
  const pulls = useQuery({
    queryKey: ["versioning-forge", repo, "pulls", state],
    enabled: connected,
    retry: false,
    staleTime: 15_000,
    queryFn: () => forge<PullRequest[]>(repo, "pulls", { state }),
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ["versioning-forge", repo] });
  const remote = info.data?.remote;
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (pulls.data ?? [])
      .map((pull) => ({
        pull,
        tickets: findTickets([pull.title, pull.head], tickets.configuration),
      }))
      .filter(
        ({ pull, tickets: found }) =>
          !needle ||
          `${pull.number} ${pull.title} ${pull.author} ${pull.head} ${found.map((ticket) => ticket.key).join(" ")}`
            .toLowerCase()
            .includes(needle),
      );
  }, [pulls.data, search, tickets.configuration]);
  const open =
    selected && (pulls.data?.find((pull) => pull.number === selected.number) ?? selected);
  if (connected && open)
    return (
      <div ref={conversation.ref}>
        <VersioningPullPage
          workspace={workspace}
          pull={open}
          tickets={tickets}
          onBack={() => setSelected(null)}
          onChanged={() => void reload()}
        />
      </div>
    );
  return (
    <section ref={feature.ref} className="space-y-4" aria-label="Pull Requests">
      <div className="flex items-center gap-1">
        <GitPullRequestIcon className="mr-1 size-4 text-primary" />
        <h2 className="flex flex-1 items-center gap-2 text-sm font-semibold">
          Pull Requests{feature.isNew && <NewBadge />}
        </h2>
        {connected && (
          <VersioningIconButton
            icon={RefreshCwIcon}
            label="Pull Requests neu laden"
            onClick={() => void reload()}
          />
        )}
        <VersioningTicketSettings workspace={workspace} tickets={tickets} />
        {connected && info.data && (
          <VersioningForgeAccount workspace={workspace} info={info.data} onChanged={reload} />
        )}
      </div>
      {info.isLoading && <Skeleton className="h-24 rounded-xl" />}
      {info.error && (
        <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-xs text-destructive">
          {String(info.error)}
        </p>
      )}
      {info.data && !remote && (
        <p className="rounded-xl bg-muted/35 p-4 text-[11px] leading-relaxed text-muted-foreground">
          {info.data.problem ??
            "Das Repository hat keinen Remote „origin“ auf GitHub, GitLab, Azure DevOps oder Gitea."}
        </p>
      )}
      {info.data && remote && !connected && (
        <VersioningForgeConnect workspace={workspace} info={info.data} />
      )}
      {connected && info.data && remote && (
        <>
          <VersioningPullCreate
            workspace={workspace}
            defaultBranch={info.data.defaultBranch ?? null}
            onCreated={(pull) => {
              setState("open");
              setSelected(pull);
              void reload();
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <fieldset
              className="flex gap-0.5 rounded-lg bg-muted/40 p-0.5"
              aria-label="Pull Requests filtern"
            >
              {FILTERS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={state === value}
                  onClick={() => setState(value)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs transition-colors",
                    state === value
                      ? "bg-background font-medium text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </fieldset>
            <div className="relative min-w-40 flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Pull Requests durchsuchen"
                placeholder="Titel, Branch, Ticket…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>
          {pulls.isLoading && <Skeleton className="h-32 rounded-xl" />}
          {pulls.error && (
            <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-xs text-destructive">
              {String(pulls.error)}
            </p>
          )}
          {pulls.data && !rows.length && (
            <p className="px-1 py-8 text-center text-xs text-muted-foreground">
              {search.trim()
                ? "Keine Treffer."
                : state === "open"
                  ? "Keine offenen Pull Requests."
                  : state === "merged"
                    ? "Noch nichts gemergt."
                    : "Keine geschlossenen Pull Requests."}
            </p>
          )}
          <ul className="space-y-0.5">
            {rows.map(({ pull, tickets: found }) => (
              <li key={pull.number}>
                <VersioningPullRow pull={pull} tickets={found} onSelect={() => setSelected(pull)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
