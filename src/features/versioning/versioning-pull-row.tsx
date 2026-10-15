import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from "lucide-react";
import { relativeTime } from "@/lib/branching/model";
import { useNow } from "@/lib/hooks/use-now";
import { cn } from "@/lib/utils";
import type { PullRequest } from "@/lib/versioning/forge";
import type { TicketReference } from "@/lib/versioning/review";
import { VersioningTicketChips } from "./versioning-ticket-chips";

export function VersioningPullRow({
  pull,
  tickets,
  onSelect,
}: {
  pull: PullRequest;
  tickets: TicketReference[];
  onSelect: () => void;
}) {
  const now = useNow();
  const Icon =
    pull.state === "merged"
      ? GitMergeIcon
      : pull.state === "closed"
        ? GitPullRequestClosedIcon
        : pull.draft
          ? GitPullRequestDraftIcon
          : GitPullRequestIcon;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          pull.state === "merged"
            ? "text-violet-600 dark:text-violet-400"
            : pull.state === "closed"
              ? "text-red-600 dark:text-red-400"
              : pull.draft
                ? "text-muted-foreground"
                : "text-emerald-600 dark:text-emerald-400",
        )}
      />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block truncate text-xs font-medium">{pull.title}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] text-muted-foreground">
          <span className="truncate">
            #{pull.number} · {pull.author} ·{" "}
            <span className="font-mono">
              {pull.head} → {pull.base}
            </span>
            {pull.draft ? " · Entwurf" : ""}
          </span>
          <VersioningTicketChips tickets={tickets} linked={false} />
        </span>
      </span>
      {pull.updatedAt && (
        <time dateTime={pull.updatedAt} className="shrink-0 text-[10px] text-muted-foreground">
          {relativeTime(pull.updatedAt, now)}
        </time>
      )}
    </button>
  );
}
