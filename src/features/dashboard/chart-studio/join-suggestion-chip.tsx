import { ArrowRightIcon } from "lucide-react";
import { JoinMatchMeter } from "./join-match-meter";
import { useJoinStats } from "./use-join-stats";

export interface StudioSuggestion {
  node: string;
  parent: { schema: string; table: string };
  target: { schema: string; table: string };
  fromColumn: string;
  toColumn: string;
  reason: string;
}

export function JoinSuggestionChip({
  suggestion,
  measure,
  onPick,
}: {
  suggestion: StudioSuggestion;
  measure: boolean;
  onPick: () => void;
}) {
  const { stats, loading, error } = useJoinStats(
    measure ? suggestion.parent : null,
    measure ? suggestion.target : null,
    [{ from: suggestion.fromColumn, to: suggestion.toColumn }],
  );
  return (
    <button
      type="button"
      onClick={onPick}
      className="group w-full space-y-1.5 rounded-lg border bg-background p-2 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="flex items-start gap-2 text-[11px]">
        <span className="min-w-0 flex-1 space-y-0.5">
          <span
            className="block truncate font-medium"
            title={`${suggestion.parent.table}.${suggestion.fromColumn}`}
          >
            {suggestion.parent.table}.{suggestion.fromColumn}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
            <ArrowRightIcon className="size-3 shrink-0" />
            <span className="truncate" title={`${suggestion.target.table}.${suggestion.toColumn}`}>
              {suggestion.target.table}.{suggestion.toColumn}
            </span>
          </span>
        </span>
        <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
          {suggestion.reason}
        </span>
      </span>
      {measure && (
        <JoinMatchMeter stats={stats} loading={loading} error={error} compact baseLabel="" />
      )}
    </button>
  );
}
