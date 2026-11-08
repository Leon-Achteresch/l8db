import { useMemo } from "react";
import { NewBadge } from "@/components/new-badge";
import { featureById } from "@/lib/discovery/catalog";
import { highlightFeature } from "@/lib/discovery/highlight";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useTeamStore } from "@/lib/team/store";
import { activeTeamTips } from "@/lib/team/tips";
import { cn } from "@/lib/utils";

export function DiscoverTeamTab() {
  const rawTips = useTeamStore((state) => state.tips);
  const exists = useTeamStore((state) => state.exists);
  const tips = useMemo(() => (exists ? activeTeamTips(rawTips) : []), [exists, rawTips]);
  const { ref, isNew } = useNewFeatureVisibility<HTMLDivElement>("discover.team-tips");

  return (
    <div ref={ref} className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        Tipps vom Team
        {isNew && <NewBadge />}
      </h2>
      {tips.length === 0 ? (
        <p className="rounded-xl bg-muted/40 p-6 text-center text-sm text-muted-foreground">
          Keine Tipps
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {tips.map((tip) => {
            const feature = tip.featureId ? featureById(tip.featureId) : undefined;
            return (
              <li key={tip.id}>
                <button
                  type="button"
                  disabled={!feature}
                  onClick={() => feature && void highlightFeature(feature.id)}
                  className={cn(
                    "flex w-full flex-col items-start gap-1 rounded-xl bg-muted/40 p-4 text-left transition-colors",
                    feature && "cursor-pointer hover:bg-muted/70 active:scale-[0.99]",
                  )}
                >
                  <span className="text-sm font-medium text-foreground">{tip.title}</span>
                  <span className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                    {tip.body}
                  </span>
                  {feature && (
                    <span className="mt-1 text-[11px] font-medium text-primary">
                      {feature.title}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
