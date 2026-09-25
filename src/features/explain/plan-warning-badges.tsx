import { AlertTriangleIcon } from "lucide-react";

import type { PlanWarning, PlanWarningKind } from "@/lib/explain-analysis";

const SHORT_LABEL: Record<PlanWarningKind, string> = {
  "full-scan": "Full Scan",
  "index-hint": "Index?",
  misestimate: "Schätzung",
  spill: "Spill",
  "nested-loop": "Loops",
};

interface PlanWarningBadgesProps {
  warnings: PlanWarning[];
}

export function PlanWarningBadges({ warnings }: PlanWarningBadgesProps) {
  if (warnings.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {warnings.map((warning) => (
        <span
          key={warning.kind}
          title={warning.message}
          className="inline-flex items-center gap-0.5 rounded border border-amber-500/40 bg-amber-500/10 px-1 text-[10px] leading-4 font-medium text-amber-700 dark:text-amber-400"
        >
          <AlertTriangleIcon className="size-2.5" />
          {SHORT_LABEL[warning.kind]}
        </span>
      ))}
    </span>
  );
}
