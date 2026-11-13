import type { ChangelogRelease } from "@/lib/changelog";
import { cn } from "@/lib/utils";
import { ReleaseGroup } from "./release-group";

const DATE = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric" });

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : DATE.format(date);
}

export function ReleaseEntry({ release, latest }: { release: ChangelogRelease; latest: boolean }) {
  return (
    <li className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-6 [content-visibility:auto] [contain-intrinsic-size:auto_16rem]">
      <div>
        <div className="sticky top-6">
          <div className="font-mono text-sm font-semibold tabular-nums">{release.version}</div>
          <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {formatDate(release.date)}
          </div>
        </div>
      </div>
      <div className="relative space-y-6 border-l border-border/70 pb-12 pl-7">
        <span
          aria-hidden
          className={cn(
            "absolute top-1.5 -left-[3.5px] size-1.5 rounded-full ring-4 ring-background",
            latest ? "bg-primary" : "bg-muted-foreground/50",
          )}
        />
        {release.groups.map((group) => (
          <ReleaseGroup key={group.title} group={group} />
        ))}
      </div>
    </li>
  );
}
