import type { SplitZone } from "@/lib/split-layout";
import { useDropPreview, ZONE_LABELS } from "@/lib/tab-drop";
import { cn } from "@/lib/utils";

const AREA: Record<SplitZone, string> = {
  center: "inset-1.5",
  left: "inset-y-1.5 left-1.5 right-1/2",
  right: "inset-y-1.5 right-1.5 left-1/2",
  top: "inset-x-1.5 top-1.5 bottom-1/2",
  bottom: "inset-x-1.5 bottom-1.5 top-1/2",
};

export function SplitDropPreview({ pane }: { pane: number | "single" }) {
  const preview = useDropPreview((state) =>
    state.preview?.pane === pane && state.preview.zone ? state.preview : null,
  );
  if (!preview?.zone) return null;
  const label = preview.swap
    ? "Bereiche tauschen"
    : preview.zone === "center" && pane !== "single"
      ? `In Bereich ${pane + 1} verschieben`
      : ZONE_LABELS[preview.zone];
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-40">
      <div
        data-split-drop-zone={preview.zone}
        className={cn(
          "absolute grid place-items-center rounded-lg border-2 border-primary/70 bg-primary/10 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--background)_60%,transparent)] transition-[inset] duration-150 ease-out motion-reduce:transition-none",
          AREA[preview.zone],
        )}
      >
        <span className="rounded-full bg-background/95 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm ring-1 ring-border">
          {label}
        </span>
      </div>
    </div>
  );
}
