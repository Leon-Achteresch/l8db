import type { ReactNode } from "react";
import { CATEGORY_BAR_CLASSES } from "@/lib/category-colors";
import type { ColumnProfile } from "@/lib/column-profile";
import { categoryColorIndex } from "@/lib/grid-cell-format";
import { cn } from "@/lib/utils";

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

export function DataTableColumnProfile({
  profile,
  temporal,
}: {
  profile: ColumnProfile;
  temporal: boolean;
}) {
  if (profile.type === "empty") return <div className="h-7" />;
  const nullRatio = profile.nullRatio;
  let stat = "";
  let title = "";
  let visual: ReactNode = null;
  if (profile.type === "histogram") {
    const peak = Math.max(...profile.bins, 1);
    stat = `${profile.min} – ${profile.max}`;
    title = `Wertebereich ${stat}`;
    visual = (
      <svg
        aria-hidden
        viewBox={`0 0 ${profile.bins.length * 10} 16`}
        preserveAspectRatio="none"
        className={cn("h-4 w-full", temporal ? "text-violet-500/70" : "text-sky-500/70")}
      >
        {profile.bins
          .map((count, index) => ({ x: index * 10 + 1, height: (count / peak) * 16 }))
          .map((bin) => (
            <rect
              key={bin.x}
              x={bin.x}
              y={16 - bin.height}
              width={8}
              height={bin.height}
              rx={1}
              fill="currentColor"
            />
          ))}
      </svg>
    );
  } else if (profile.type === "categories") {
    const top = profile.parts[0];
    stat = `${top.value} ${percent(top.count / profile.total)}`;
    title = profile.parts.map((part) => `${part.value}: ${part.count}`).join("\n");
    visual = (
      <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-muted-foreground/15">
        {profile.parts.map((part) => (
          <span
            key={part.value}
            className={cn(
              "h-full opacity-80",
              CATEGORY_BAR_CLASSES[categoryColorIndex(part.value)],
            )}
            style={{ width: percent(part.count / profile.total) }}
          />
        ))}
      </div>
    );
  } else if (profile.type === "boolean") {
    stat = `${percent(profile.trueRatio)} true`;
    title = stat;
    visual = (
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted-foreground/15">
        <span
          className="block h-full bg-emerald-500/80"
          style={{ width: percent(profile.trueRatio) }}
        />
      </div>
    );
  } else {
    const unique = profile.total > 0 && profile.distinct === profile.total;
    stat = unique ? "eindeutig" : `${profile.distinct} versch.`;
    title = `${profile.distinct} verschiedene Werte in ${profile.total} Zeilen`;
    visual = (
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted-foreground/15">
        <span
          className="block h-full bg-sky-500/60"
          style={{ width: percent(profile.total ? profile.distinct / profile.total : 0) }}
        />
      </div>
    );
  }
  return (
    <div className="flex w-full min-w-0 flex-col gap-1" title={title}>
      <div className="flex h-4 items-end">{visual}</div>
      <div className="flex min-w-0 items-center justify-between gap-1.5 font-sans text-[10px] leading-3 font-normal text-muted-foreground">
        <span className="truncate">{stat}</span>
        {nullRatio > 0 ? (
          <span className="shrink-0 text-rose-600 dark:text-rose-400">
            {percent(nullRatio)} null
          </span>
        ) : null}
      </div>
    </div>
  );
}
