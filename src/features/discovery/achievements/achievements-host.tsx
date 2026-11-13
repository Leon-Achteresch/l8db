import { useNavigate } from "@tanstack/react-router";
import { Trophy } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DiscoveryNoteCard } from "@/features/discovery/team-tips/discovery-note-card";
import { nextFeature } from "@/lib/discovery/achievements/engine";
import { ACHIEVEMENTS } from "@/lib/discovery/achievements/rules";
import {
  ACHIEVEMENT_SUMMARY,
  clearPendingAchievement,
  evaluateAchievements,
  primeAchievements,
  recordAchievementEvent,
  useAchievementsStore,
} from "@/lib/discovery/achievements/store";
import { featureById } from "@/lib/discovery/catalog";
import { onFeatureEvent } from "@/lib/discovery/events";
import { highlightFeature } from "@/lib/discovery/highlight";
import { useSurfaceSlot } from "@/lib/discovery/team-tips/use-surface-slot";
import { onFeatureUsed, useFeatureUsageStore } from "@/lib/discovery/usage";
import { useSettingsStore } from "@/lib/settings";
import { usageStatisticsStore } from "@/lib/usage-statistics";

export function AchievementsHost() {
  const navigate = useNavigate();
  const enabled = useSettingsStore(
    (state) => state.discovery.enabled && state.discovery.channels.achievements,
  );
  const pending = useAchievementsStore((state) => state.pending);
  const summaryCount = useAchievementsStore((state) => state.summaryCount);
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    primeAchievements(usageStatisticsStore.getSnapshot());
    evaluateAchievements();
    const stopUsed = onFeatureUsed(() => evaluateAchievements());
    const stopEvents = onFeatureEvent((event) => recordAchievementEvent(event));
    return () => {
      stopUsed();
      stopEvents();
    };
  }, [enabled]);

  const current = shown ?? pending;
  const request = useMemo(
    () =>
      enabled && current ? { channel: "achievements" as const, id: current, priority: 30 } : null,
    [enabled, current],
  );
  const { visible, release } = useSurfaceSlot(request);

  useEffect(() => {
    if (!visible || !current) return;
    setShown(current);
    clearPendingAchievement();
  }, [visible, current]);

  const close = useCallback(() => {
    release();
    setShown(null);
  }, [release]);

  if (!visible || !current) return null;
  const openTab = {
    label: "Alle Erfolge",
    onClick: () => {
      close();
      void navigate({ to: "/discover", search: { tab: "achievements" } });
    },
  };
  if (current === ACHIEVEMENT_SUMMARY)
    return (
      <DiscoveryNoteCard
        icon={Trophy}
        eyebrow="Erfolge"
        title={
          summaryCount === 1 ? "1 Erfolg freigeschaltet" : `${summaryCount} Erfolge freigeschaltet`
        }
        onClose={close}
        actions={[openTab]}
      />
    );
  const rule = ACHIEVEMENTS.find((item) => item.id === current);
  if (!rule) return null;
  const next = nextFeature(rule, useFeatureUsageStore.getState().usage, featureById);
  return (
    <DiscoveryNoteCard
      icon={Trophy}
      eyebrow="Erfolg freigeschaltet"
      title={rule.title}
      body={next ? `Als Nächstes: ${next.title}` : rule.summary}
      onClose={close}
      actions={
        next
          ? [
              {
                label: "Nächstes ausprobieren",
                onClick: () => {
                  close();
                  void highlightFeature(next.id);
                },
              },
              openTab,
            ]
          : [openTab]
      }
    />
  );
}
