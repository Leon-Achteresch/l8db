import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, MessageSquareIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { PullComment } from "@/lib/versioning/forge";
import { readFile } from "@/lib/versioning/repository";
import { CATEGORY_LABELS, type ChangedObject, tableChanges } from "@/lib/versioning/review";
import { CATEGORY_ICONS, STATUS_TONES } from "./versioning-object-kinds";
import { VersioningReviewDiff } from "./versioning-review-diff";

export function VersioningPullObject({
  repo,
  entry,
  base,
  head,
  threads,
  expanded,
  onToggle,
  onComment,
  onReply,
}: {
  repo: string;
  entry: ChangedObject;
  base: string;
  head: string;
  threads: PullComment[][];
  expanded: boolean;
  onToggle: () => void;
  onComment?: (line: number, side: "new" | "old", body: string) => Promise<void>;
  onReply?: (thread: PullComment[], body: string) => Promise<void>;
}) {
  const content = useQuery({
    queryKey: ["versioning-pull-file", repo, base, head, entry.path],
    enabled: expanded,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => ({
      original: entry.status === "A" ? "" : ((await readFile(repo, entry.path, base)) ?? ""),
      modified: entry.status === "D" ? "" : ((await readFile(repo, entry.path, head)) ?? ""),
    }),
  });
  const Icon = CATEGORY_ICONS[entry.category];
  const status = STATUS_TONES[entry.status] ?? { label: entry.status, tone: "" };
  const structure =
    entry.category === "table" && content.data
      ? tableChanges(content.data.original, content.data.modified)
      : null;
  const comments = threads.reduce((sum, thread) => sum + thread.length, 0);
  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        title={entry.path}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-muted/40",
          expanded && "bg-muted/40",
        )}
      >
        <ChevronRightIcon
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
        <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.7} />
        <span className="min-w-0 flex-1 truncate text-xs">
          {entry.schema && <span className="text-muted-foreground">{entry.schema}.</span>}
          <span className="font-medium">{entry.name}</span>
        </span>
        {comments > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
            <MessageSquareIcon className="size-3" />
            {comments}
          </span>
        )}
        <span className={cn("shrink-0 text-[10px]", status.tone)}>{status.label}</span>
      </button>
      {expanded && (
        <div className="space-y-2 py-2 pl-5">
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {CATEGORY_LABELS[entry.category][0]} · {entry.path}
          </p>
          {content.isLoading && <Skeleton className="h-32 rounded-lg" />}
          {content.error && (
            <p role="alert" className="text-[11px] text-destructive">
              {String(content.error)}
            </p>
          )}
          {structure && structure.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Strukturänderungen">
              {structure.map((change) => (
                <li
                  key={change.section}
                  className="flex flex-wrap items-center gap-1 rounded-md bg-muted/40 px-2 py-1 text-[10px]"
                >
                  <span className="font-medium">{change.section}</span>
                  {change.added.map((name) => (
                    <span
                      key={`+${name}`}
                      className="font-mono text-emerald-700 dark:text-emerald-400"
                    >
                      +{name}
                    </span>
                  ))}
                  {change.changed.map((name) => (
                    <span key={`~${name}`} className="font-mono text-amber-700 dark:text-amber-400">
                      ~{name}
                    </span>
                  ))}
                  {change.removed.map((name) => (
                    <span key={`-${name}`} className="font-mono text-red-700 dark:text-red-400">
                      −{name}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}
          {content.data && (
            <VersioningReviewDiff
              before={content.data.original}
              after={content.data.modified}
              threads={threads}
              onComment={onComment}
              onReply={onReply}
            />
          )}
        </div>
      )}
    </div>
  );
}
