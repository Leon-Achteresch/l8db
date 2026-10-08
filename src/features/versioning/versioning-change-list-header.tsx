import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DevelopmentState } from "./use-development";
import type { VersioningWorkspace } from "./use-versioning";

export function VersioningChangeListHeader({
  workspace,
  development,
  open,
  onToggle,
}: {
  workspace: VersioningWorkspace;
  development: DevelopmentState;
  open?: boolean;
  onToggle?: () => void;
}) {
  const { changes, showAll, setShowAll, selected, setSelected } = development;
  const total = showAll ? (workspace.status?.files.length ?? 0) : changes.size;
  const title = showAll ? "Alle Dateien" : "Geänderte Objekte";
  return (
    <div className="flex h-8 items-center gap-1.5 pr-2 text-xs">
      {onToggle ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1 text-left font-semibold focus-visible:outline-none"
        >
          <ChevronDownIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              !open && "-rotate-90",
            )}
          />
          <span className="truncate">{title}</span>
        </button>
      ) : (
        <span className="min-w-0 flex-1 truncate pl-1 font-semibold">{title}</span>
      )}
      <input
        type="checkbox"
        aria-label="Alle offenen Dateien auswählen"
        title="Alle offenen Dateien auswählen"
        className="size-3.5"
        disabled={!changes.size}
        checked={Boolean(changes.size) && selected.length === changes.size}
        onChange={(event) => setSelected(event.target.checked ? [...changes.keys()] : [])}
      />
      <button
        type="button"
        aria-pressed={showAll}
        aria-label="Alle Dateien"
        title={showAll ? "Nur offene Änderungen zeigen" : "Alle Dateien zeigen"}
        onClick={() => setShowAll(!showAll)}
        className={cn(
          "rounded px-1.5 py-0.5 text-[11px] transition-colors",
          showAll ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        Alle
      </button>
      <span className="min-w-4 text-right text-[11px] text-muted-foreground tabular-nums">
        {total}
      </span>
    </div>
  );
}
