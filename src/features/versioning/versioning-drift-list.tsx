import { DatabaseIcon } from "lucide-react";
import { CompareObjectIcon } from "@/features/compare/compare-object-icon";
import { COMPARE_OBJECT_LABELS } from "@/lib/compare-types";
import { cn } from "@/lib/utils";
import type { DriftStatus } from "@/lib/versioning/drift";
import type { DatabaseDrift } from "./use-database-drift";

const LETTER: Record<DriftStatus, { letter: string; label: string; className: string }> = {
  changed: {
    letter: "M",
    label: "In der Datenbank geändert",
    className: "text-amber-600 dark:text-amber-400",
  },
  added: {
    letter: "A",
    label: "Neu in der Datenbank",
    className: "text-emerald-600 dark:text-emerald-400",
  },
  removed: {
    letter: "D",
    label: "In der Datenbank entfernt",
    className: "text-destructive",
  },
};

export function VersioningDriftList({
  drift,
  onOpen,
}: {
  drift: DatabaseDrift;
  onOpen: (id: string) => void;
}) {
  const { entries, selected, setSelected, focus } = drift;
  if (!entries?.length) return null;
  return (
    <ul className="flex flex-col" aria-label="Änderungen in der Datenbank">
      {entries.map((entry) => {
        const { id, selection } = entry.object;
        const status = LETTER[entry.status];
        return (
          <li
            key={id}
            className={cn(
              "group flex h-7 items-center gap-2 rounded-md pr-2 pl-1 transition-colors hover:bg-muted/50",
              focus === id && "bg-muted",
            )}
          >
            <input
              type="checkbox"
              aria-label={`Commit: ${selection.objectName}`}
              checked={selected.includes(id)}
              onChange={(event) =>
                setSelected((items) =>
                  event.target.checked ? [...items, id] : items.filter((item) => item !== id),
                )
              }
              className={cn(
                "size-3.5 shrink-0",
                selected.includes(id) && "opacity-60 group-hover:opacity-100",
              )}
            />
            <button
              type="button"
              title={`${selection.schema}.${selection.objectName}`}
              onClick={() => onOpen(id)}
              className="flex h-full min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
            >
              <CompareObjectIcon type={selection.objectType} className="size-3.5" />
              <span
                className={cn(
                  "min-w-0 truncate font-mono text-xs",
                  entry.status === "removed" && "text-muted-foreground line-through",
                )}
              >
                {selection.objectName}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                {COMPARE_OBJECT_LABELS[selection.objectType]}
              </span>
              <DatabaseIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/60" />
              <span
                role="img"
                title={status.label}
                aria-label={status.label}
                className={cn(
                  "w-3 shrink-0 text-center font-mono text-[11px] font-semibold",
                  status.className,
                )}
              >
                {status.letter}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
