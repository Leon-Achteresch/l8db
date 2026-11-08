import { Lock, Trophy } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Switch } from "@/components/ui/switch";
import { nextFeature } from "@/lib/discovery/achievements/engine";
import { ACHIEVEMENTS } from "@/lib/discovery/achievements/rules";
import { useAchievementsStore } from "@/lib/discovery/achievements/store";
import { featureById } from "@/lib/discovery/catalog";
import { highlightFeature } from "@/lib/discovery/highlight";
import { setLab, useLab } from "@/lib/discovery/labs/labs";
import { useFeatureUsage } from "@/lib/discovery/usage";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";

export function DiscoverAchievementsTab() {
  const enabled = useLab("achievements");
  const unlocked = useAchievementsStore((state) => state.unlocked);
  const usage = useFeatureUsage();
  const { ref, isNew } = useNewFeatureVisibility<HTMLDivElement>("discover.achievements");
  const count = ACHIEVEMENTS.filter((rule) => unlocked[rule.id] !== undefined).length;

  return (
    <div ref={ref} className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          Erfolge
          {isNew && <NewBadge />}
          <span className="tabular-nums">
            {count}/{ACHIEVEMENTS.length}
          </span>
        </h2>
        <div className="ml-auto flex items-center gap-2 text-sm">
          Erfolge sammeln
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => setLab("achievements", checked)}
            aria-label="Erfolge sammeln"
          />
        </div>
      </div>
      <ul className={cn("grid gap-2 sm:grid-cols-2 lg:grid-cols-3", !enabled && "opacity-60")}>
        {ACHIEVEMENTS.map((rule) => {
          const done = unlocked[rule.id] !== undefined;
          const next = done ? nextFeature(rule, usage, featureById) : null;
          return (
            <li
              key={rule.id}
              className={cn(
                "flex flex-col gap-1 rounded-xl p-4",
                done ? "bg-muted/60" : "bg-muted/30",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                {done ? (
                  <Trophy className="size-4 text-primary" />
                ) : (
                  <Lock className="size-4 text-muted-foreground" />
                )}
                <span className={done ? "text-foreground" : "text-muted-foreground"}>
                  {rule.title}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">{rule.summary}</span>
              {next && (
                <button
                  type="button"
                  onClick={() => void highlightFeature(next.id)}
                  className="mt-1 cursor-pointer self-start rounded text-[11px] font-medium text-primary hover:underline"
                >
                  {next.title}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
