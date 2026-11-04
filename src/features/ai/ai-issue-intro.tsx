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
        className="my-2 flex w-full items-center gap-2 rounded-xl border border-dashed border-primary/25 bg-primary/[0.03] px-3 py-2 text-left text-xs text-muted-foreground outline-none transition-colors hover:bg-primary/[0.07] focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CircleDot className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="font-medium text-foreground">Probleme direkt als Issue melden</span>
          <span className="mt-0.5 block">Mit Vorschau und geschwärztem Screenshot.</span>
        </span>
        {feature.isNew && <NewBadge />}
        <Play className="size-3.5 shrink-0" />
        <span className="sr-only">So funktioniert’s</span>
      </button>
      {open && (
        <Suspense fallback={null}>
          <Guide onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
