import { useNavigate } from "@tanstack/react-router";
import { CalendarHeart } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DiscoveryNoteCard } from "@/features/discovery/team-tips/discovery-note-card";
import { onFeatureEvent } from "@/lib/discovery/events";
import { recapYear } from "@/lib/discovery/recap/model";
import { recordRecapActivity, useRecapStore } from "@/lib/discovery/recap/store";
import { useSurfaceSlot } from "@/lib/discovery/team-tips/use-surface-slot";
import { onFeatureUsed } from "@/lib/discovery/usage";
import { useSettingsStore } from "@/lib/settings";

export function RecapHost() {
  const navigate = useNavigate();
  const statsEnabled = useSettingsStore((state) => state.localUsageStats);
  const offeredYear = useRecapStore((state) => state.offeredYear);
  const markOffered = useRecapStore((state) => state.markOffered);
  const [year, setYear] = useState(() => recapYear());
  const [showing, setShowing] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setYear(recapYear()), 60 * 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!statsEnabled) return;
    const stopUsed = onFeatureUsed(() => recordRecapActivity());
    const stopEvents = onFeatureEvent((event) => {
      if (event.name === "query.finished" && typeof event.data.durationMs === "number")
        recordRecapActivity(event.at, event.data.durationMs);
    });
    return () => {
      stopUsed();
      stopEvents();
    };
  }, [statsEnabled]);

  const request = useMemo(
    () =>
      year !== null && (showing || offeredYear !== year)
        ? { channel: "recap" as const, id: `year-${year}`, priority: 20 }
        : null,
    [year, offeredYear, showing],
  );
  const { visible, release } = useSurfaceSlot(request);

  useEffect(() => {
    if (!visible || year === null) return;
    setShowing(true);
    markOffered(year);
  }, [visible, year, markOffered]);

  const close = useCallback(() => {
    release();
    setShowing(false);
  }, [release]);

  if (!visible || year === null) return null;
  return (
    <DiscoveryNoteCard
      icon={CalendarHeart}
      eyebrow="Rückblick"
      title={`Dein l8db-Jahr ${year}`}
      onClose={close}
      actions={[
        {
          label: "Ansehen",
          onClick: () => {
            close();
            void navigate({ to: "/discover", search: { tab: "recap" } });
          },
        },
      ]}
    />
  );
}
