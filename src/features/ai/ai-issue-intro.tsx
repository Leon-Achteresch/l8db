import { CircleDot, Play } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

const Guide = lazy(() =>
  import("./ai-issue-guide").then((module) => ({ default: module.AiIssueGuide })),
);

export function AiIssueIntro() {
  const feature = useNewFeatureVisibility<HTMLButtonElement>("ai.chat.issue-cards");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={feature.ref}
        type="button"
        onClick={() => setOpen(true)}
        title="So meldest du Probleme direkt als Issue – mit Vorschau und geschwärztem Screenshot"
        className="mt-3 flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[11px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CircleDot className="size-3 shrink-0" />
        Problem als Issue melden
        <Play className="size-2.5 shrink-0 fill-current" />
        {feature.isNew && <NewBadge />}
      </button>
      {open && (
        <Suspense fallback={null}>
          <Guide onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
