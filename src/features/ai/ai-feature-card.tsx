import { Eye, MousePointer2 } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { featureShortcut } from "@/lib/ai/feature-search";
import { featureById } from "@/lib/discovery/catalog";
import { startGuide } from "@/lib/discovery/guide";
import { highlightFeature } from "@/lib/discovery/highlight";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function AiFeatureCard({ id }: { id: string }) {
  const entry = featureById(id);
  const { ref, isNew } = useNewFeatureVisibility<HTMLDivElement>("ai.chat.feature-search");
  const companion = useNewFeatureVisibility<HTMLParagraphElement>("ai.chat.companion");
  if (!entry) return null;
  const shortcut = featureShortcut(entry);
  return (
    <div
      ref={ref}
      className="my-2 flex flex-wrap items-center gap-3 rounded-xl bg-muted/50 px-4 py-3"
    >
      <div className="min-w-0 flex-1 basis-56">
        <p
          ref={companion.ref}
          className="flex items-center gap-2 text-sm font-medium text-foreground"
        >
          {entry.title}
          {shortcut && (
            <kbd className="rounded bg-background/70 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {shortcut}
            </kbd>
          )}
          {(isNew || companion.isNew) && <NewBadge />}
        </p>
        <p className="text-xs text-muted-foreground">{entry.summary}</p>
      </div>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="cursor-pointer"
          onClick={() => void highlightFeature(entry.id)}
        >
          <Eye />
          Zeigen
        </Button>
        {entry.steps?.length ? (
          <Button
            size="sm"
            className="cursor-pointer"
            data-feature="discover.guide"
            onClick={() => startGuide(entry.id)}
          >
            <MousePointer2 />
            Zeig's mir
          </Button>
        ) : null}
      </div>
    </div>
  );
}
