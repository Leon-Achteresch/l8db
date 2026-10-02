import { useState } from "react";
import { cn } from "@/lib/utils";
import { NewBadgeExitPreview } from "./new-badge-exit-preview";
import { BADGE_EXIT_VARIANTS } from "./new-badge-exit-variants";

export function NewBadgeExitLab() {
  const [slow, setSlow] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">NEW-Badge verabschieden</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Vier Richtungen für den Moment, in dem das Badge verschwindet: kurz nach oben, dann nach
            unten weg.
          </p>
        </div>
        <button
          type="button"
          aria-pressed={slow}
          onClick={() => setSlow(!slow)}
          className={cn(
            "h-8 rounded-md border px-3 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
            slow && "bg-muted",
          )}
        >
          Zeitlupe
        </button>
      </div>
      <div className="grid gap-8 md:grid-cols-2">
        {BADGE_EXIT_VARIANTS.map((variant) => (
          <NewBadgeExitPreview key={variant.id} variant={variant} slow={slow} />
        ))}
      </div>
    </div>
  );
}
