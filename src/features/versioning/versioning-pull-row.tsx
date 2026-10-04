import { GitMergeIcon, GitPullRequestDraftIcon, GitPullRequestIcon } from "lucide-react";
import { relativeTime } from "@/lib/branching/model";
import { useNow } from "@/lib/hooks/use-now";
import { cn } from "@/lib/utils";
import type { PullRequest } from "@/lib/versioning/forge";

export function VersioningPullRow({
  pull,
  selected,
  onSelect,
}: {
  pull: PullRequest;
  selected: boolean;
  onSelect: () => void;
}) {
  const now = useNow();
  const Icon =
    pull.state === "merged"
      ? GitMergeIcon
      : pull.draft
        ? GitPullRequestDraftIcon
        : GitPullRequestIcon;
  return (
    <button
      type="button"
      aria-expanded={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/40",
        selected && "bg-muted/40",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          pull.state === "merged"
            ? "text-violet-600 dark:text-violet-400"
            : pull.draft
              ? "text-muted-foreground"
              : "text-emerald-600 dark:text-emerald-400",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{pull.title}</span>
        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
          #{pull.number} · {pull.author} ·{" "}
          <span className="font-mono">
            {pull.head} → {pull.base}
          </span>
          {pull.draft ? " · Entwurf" : ""}
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
