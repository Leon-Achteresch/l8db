import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLinkIcon, GitPullRequestIcon, LogOutIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";
import {
  FORGE_LABELS,
  type ForgeInfo,
  forge,
  openForgeUrl,
  type PullRequest,
} from "@/lib/versioning/forge";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningForgeConnect } from "./versioning-forge-connect";
import { VersioningIconButton } from "./versioning-icon-button";
import { VersioningPullCreate } from "./versioning-pull-create";
import { VersioningPullDetail } from "./versioning-pull-detail";
import { VersioningPullRow } from "./versioning-pull-row";

export function VersioningReviews({ workspace }: { workspace: VersioningWorkspace }) {
  const feature = useNewFeatureVisibility<HTMLElement>("versioning.reviews");
  const { repo, run } = workspace;
  const queryClient = useQueryClient();
  const [state, setState] = useState<"open" | "merged">("open");
  const [selected, setSelected] = useState<number | null>(null);
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
  return (
    <section ref={feature.ref} className="space-y-5" aria-label="Reviews">
      <div className="flex items-center gap-2">
        <GitPullRequestIcon className="size-4 text-primary" />
        <h2 className="flex flex-1 items-center gap-2 text-sm font-semibold">
          Reviews{feature.isNew && <NewBadge />}
        </h2>
        {connected && (
          <VersioningIconButton
            icon={RefreshCwIcon}
            label="Pull Requests neu laden"
            onClick={() => void reload()}
          />
        )}
        {remote && (
          <VersioningIconButton
            icon={ExternalLinkIcon}
            label="Repository im Browser öffnen"
            onClick={() => void run(() => openForgeUrl(remote.web))}
          />
        )}
        {connected && (
          <VersioningIconButton
            icon={LogOutIcon}
            label="Verbindung zur Git-Plattform trennen"
            onClick={() =>
              void run(async () => {
                await forge(repo, "disconnect");
                await reload();
              }, "Zugangstoken entfernt")
            }
          />
        )}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Alle Kunden teilen ein Repository. Änderungen kommen über Pull Requests in den Hauptbranch;
        Kolleginnen und Kollegen prüfen sie hier oder auf der Plattform. Ausgeliefert wird nur, was
        gemergt ist.
      </p>
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
          <p className="text-[11px] text-muted-foreground">
            {info.data.kind ? FORGE_LABELS[info.data.kind] : remote.host} ·{" "}
            <span className="font-mono">{remote.path}</span> · angemeldet als {info.data.account}
          </p>
          <VersioningPullCreate
            workspace={workspace}
            defaultBranch={info.data.defaultBranch ?? null}
            onCreated={(number) => {
              setState("open");
              setSelected(number);
              void reload();
            }}
          />
          <fieldset className="flex gap-1" aria-label="Pull Requests filtern">
            {(
              [
                ["open", "Offen"],
                ["merged", "Gemergt"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={state === value}
                onClick={() => {
                  setState(value);
                  setSelected(null);
                }}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                  state === value
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/50",
                )}
              >
                {label}
              </button>
            ))}
          </fieldset>
          {pulls.isLoading && <Skeleton className="h-32 rounded-xl" />}
          {pulls.error && (
            <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-xs text-destructive">
              {String(pulls.error)}
            </p>
          )}
          {pulls.data && !pulls.data.length && (
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">
              {state === "open" ? "Keine offenen Pull Requests." : "Noch nichts gemergt."}
            </p>
          )}
          <ul className="space-y-0.5">
            {pulls.data?.map((pull) => (
              <li key={pull.number}>
                <VersioningPullRow
                  pull={pull}
                  selected={selected === pull.number}
                  onSelect={() => setSelected(selected === pull.number ? null : pull.number)}
                />
                {selected === pull.number && (
                  <VersioningPullDetail
                    workspace={workspace}
                    pull={pull}
                    onChanged={() => void reload()}
                  />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
