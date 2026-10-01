import { ArrowLeftRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { LinkAnchor } from "@/lib/split-links";
import { useSplitView } from "@/lib/split-view";
import { cn } from "@/lib/utils";

const grid = (pane: number) =>
  document.querySelector<HTMLElement>(`[data-split-pane="${pane}"] [data-grid-scroll]`);

export function ScrollSyncButton({
  first,
  second,
  anchor,
}: {
  first: number;
  second: number;
  anchor: LinkAnchor;
}) {
  const [active, setActive] = useState(false);
  const feature = useNewFeatureVisibility<HTMLButtonElement>("split.scroll-sync");

  useEffect(() => {
    if (!active) return;
    const lead = useSplitView.getState().focusedPane === second ? second : first;
    let driver: Element | null = grid(lead);
    const follower = grid(lead === first ? second : first);
    if (driver && follower) follower.scrollLeft = driver.scrollLeft;
    const engage = (event: Event) => {
      driver = event.target instanceof Element ? event.target.closest("[data-grid-scroll]") : null;
    };
    const follow = (event: Event) => {
      if (!driver || event.target !== driver) return;
      const a = grid(first);
      const b = grid(second);
      const other = driver === a ? b : driver === b ? a : null;
      if (other) other.scrollLeft = driver.scrollLeft;
    };
    const options = { capture: true, passive: true };
    for (const type of ["wheel", "pointerdown", "keydown"]) {
      document.addEventListener(type, engage, options);
    }
    document.addEventListener("scroll", follow, options);
    return () => {
      for (const type of ["wheel", "pointerdown", "keydown"]) {
        document.removeEventListener(type, engage, options);
      }
      document.removeEventListener("scroll", follow, options);
    };
  }, [active, first, second]);

  const label = active ? "Synchrones Scrollen beenden" : "Horizontal synchron scrollen";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={feature.ref}
          type="button"
          aria-label={label}
          aria-pressed={active}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onClick={() => setActive((value) => !value)}
          style={{ left: anchor.x, top: anchor.y }}
          className={cn(
            "pointer-events-auto absolute grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border bg-background shadow-sm transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
            active
              ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
              : "border-dashed border-muted-foreground/60 text-muted-foreground",
          )}
        >
          <ArrowLeftRightIcon className="size-3" />
          {feature.isNew && <NewBadge className="absolute -top-2 left-3.5" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {active
          ? `Bereiche ${first + 1} und ${second + 1} scrollen horizontal synchron. Klicken zum Beenden.`
          : `Bereiche ${first + 1} und ${second + 1} zeigen dieselbe Tabelle. Klicken, um horizontal synchron zu scrollen.`}
      </TooltipContent>
    </Tooltip>
  );
}
