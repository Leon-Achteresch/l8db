import { cn } from "@/lib/utils";
import type { NotificationStackClassNames, NotificationStackItem } from "./types";

export function NotificationCardContent({
  item,
  classNames,
}: {
  item: NotificationStackItem;
  classNames?: NotificationStackClassNames;
}) {
  return (
    <span className={cn("flex min-w-0 flex-col gap-1.5 py-4", classNames?.content)}>
      <span className="flex min-w-0 items-start justify-between gap-3">
        <span className={cn("min-w-0 text-sm font-medium leading-snug", classNames?.title)}>
          {item.title}
        </span>
        {item.trailing ? (
          <span className={cn("shrink-0 text-xs", classNames?.trailing)}>{item.trailing}</span>
        ) : null}
      </span>
      {item.description ? (
        <span
          className={cn("text-xs leading-relaxed text-muted-foreground", classNames?.description)}
        >
          {item.description}
        </span>
      ) : null}
    </span>
  );
}
