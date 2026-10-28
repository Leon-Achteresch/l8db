import type { FilterAiChange } from "@/lib/filter-ai/types";
import { cn } from "@/lib/utils";

const KIND = {
  add: {
    sign: "+",
    spoken: "Neu",
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  remove: { sign: "−", spoken: "Entfällt", tone: "bg-red-500/15 text-red-700 dark:text-red-300" },
  keep: { sign: "=", spoken: "Bleibt", tone: "bg-muted text-muted-foreground" },
} as const;

export function FilterAiChangeRow({
  change,
  sqlLabel,
}: {
  change: FilterAiChange;
  sqlLabel: string;
}) {
  const kind = KIND[change.kind];
  const target = change.target === "rule" ? "Farbe" : change.target === "sql" ? sqlLabel : "Filter";
  return (
    <li className="flex min-w-0 items-center gap-2 text-xs">
      <span
        className={cn(
          "inline-flex w-16 shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-medium",
          kind.tone,
        )}
      >
        <span aria-hidden>{kind.sign}</span>
        <span className="sr-only">{kind.spoken}:</span>
        {target}
      </span>
      {change.color ? (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: change.color }}
        />
      ) : null}
      <span
        title={change.label}
        className={cn(
          "min-w-0 truncate font-mono",
          change.kind === "remove" && "text-muted-foreground line-through",
          change.kind === "keep" && "text-muted-foreground",
        )}
      >
        {change.label}
      </span>
    </li>
  );
}
