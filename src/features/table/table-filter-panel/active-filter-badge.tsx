import { XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { normalizeFilterExpressionQuotes } from "@/lib/filter-parser";
import type { FilterMode } from "./filter-types";

export function ActiveFilterBadge({
  activeFilter,
  badgeDraft,
  setBadgeDraft,
  native,
  json,
  reset,
  setSql,
  setMode,
  setParseError,
  onApply,
}: {
  activeFilter: string;
  badgeDraft: string | null;
  setBadgeDraft: (value: string | null) => void;
  native: boolean;
  json: boolean;
  reset: () => void;
  setSql: (value: string) => void;
  setMode: (value: FilterMode) => void;
  setParseError: (value: string) => void;
  onApply: (where: string, isRaw: boolean) => void;
}) {
  return (
    <Badge variant="secondary" className="min-w-0 gap-1 font-normal">
      {badgeDraft !== null ? (
        <input
          ref={(input) => input?.focus()}
          aria-label="Aktiven Filter bearbeiten"
          value={badgeDraft}
          onChange={(event) => setBadgeDraft(event.target.value)}
          onBlur={() => setBadgeDraft(null)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              setBadgeDraft(null);
            }
            if (event.key === "Enter") {
              event.preventDefault();
              const next =
                native || json
                  ? badgeDraft.trim()
                  : normalizeFilterExpressionQuotes(badgeDraft.trim());
              setBadgeDraft(null);
              if (next === activeFilter.trim()) return;
              if (!next) {
                reset();
                return;
              }
              setSql(next);
              setMode("sql");
              setParseError("");
              onApply(next, true);
            }
          }}
          style={{ width: `${Math.max(12, badgeDraft.length + 2)}ch` }}
          className="max-w-[50vw] min-w-0 rounded-sm bg-background px-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring sm:max-w-80"
        />
      ) : (
        <button
          type="button"
          onDoubleClick={() => setBadgeDraft(activeFilter)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setBadgeDraft(activeFilter);
            }
          }}
          aria-label="Aktiven Filter bearbeiten"
          title="Doppelklicken zum Bearbeiten"
          className="max-w-[50vw] cursor-text truncate rounded-sm font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring sm:max-w-80"
        >
          {activeFilter}
        </button>
      )}
      <button
        type="button"
        onClick={reset}
        aria-label="Filter entfernen"
        className="-mr-0.5 rounded-sm opacity-70 hover:opacity-100"
      >
        <XIcon className="size-3" />
      </button>
    </Badge>
  );
}
