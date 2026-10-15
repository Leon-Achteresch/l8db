import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PullRequest } from "@/lib/versioning/forge";

const STATES = {
  open: {
    label: "Offen",
    icon: GitPullRequestIcon,
    tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  draft: {
    label: "Entwurf",
    icon: GitPullRequestDraftIcon,
    tone: "bg-muted text-muted-foreground",
  },
  merged: {
    label: "Gemergt",
    icon: GitMergeIcon,
    tone: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  closed: {
    label: "Geschlossen",
    icon: GitPullRequestClosedIcon,
    tone: "bg-red-500/10 text-red-700 dark:text-red-300",
  },
} as const;

export function VersioningPullState({ pull }: { pull: PullRequest }) {
  const state = STATES[pull.state === "open" && pull.draft ? "draft" : pull.state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        state.tone,
      )}
    >
      <state.icon className="size-3" />
      {state.label}
    </span>
  );
}
