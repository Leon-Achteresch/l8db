import { activeAiLimits, aiLimitReset, useAiLimits } from "@/lib/ai/limits";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";

export function AiLimits({ profileId }: { profileId: string }) {
  const feature = useNewFeatureVisibility<HTMLUListElement>("ai.usage.limits");
  const limits = activeAiLimits(useAiLimits((state) => state.limits[profileId]));
  if (!limits.length) return null;
  return (
    <ul ref={feature.ref} aria-label="Abo-Limits" className="space-y-2">
      {limits.map((limit) => (
        <li key={limit.id} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 tabular-nums">
            <span className="truncate text-muted-foreground">Limit · {limit.label}</span>
            <span className={cn("shrink-0", limit.rejected && "text-destructive")}>
              {limit.rejected ? "erreicht" : `${Math.round(limit.used)} %`}
              {limit.resetsAt ? ` · bis ${aiLimitReset(limit.resetsAt)}` : ""}
            </span>
          </div>
          <div className="h-0.5 rounded-full bg-muted">
            <div
              style={{ width: `${Math.max(2, limit.used)}%` }}
              className={cn(
                "h-full rounded-full",
                limit.rejected || limit.used >= 90
                  ? "bg-destructive"
                  : limit.used >= 70
                    ? "bg-amber-500"
                    : "bg-foreground/60",
              )}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
