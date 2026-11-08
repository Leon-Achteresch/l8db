import { Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DiscoveryNoteCard } from "@/features/discovery/team-tips/discovery-note-card";
import { featureById } from "@/lib/discovery/catalog";
import { highlightFeature } from "@/lib/discovery/highlight";
import { nextTeamTip, useTeamTipsStore } from "@/lib/discovery/team-tips/store";
import { useSurfaceSlot } from "@/lib/discovery/team-tips/use-surface-slot";
import { useTeamStore } from "@/lib/team/store";
import { activeTeamTips } from "@/lib/team/tips";

export function TeamTipsHost() {
  const rawTips = useTeamStore((state) => state.tips);
  const exists = useTeamStore((state) => state.exists);
  const seen = useTeamTipsStore((state) => state.seen);
  const markSeen = useTeamTipsStore((state) => state.markSeen);
  const [now, setNow] = useState(Date.now);
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60 * 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const tips = useMemo(() => (exists ? activeTeamTips(rawTips, now) : []), [exists, rawTips, now]);
  const tip = useMemo(
    () => tips.find((item) => item.id === shown) ?? nextTeamTip(tips, seen),
    [tips, seen, shown],
  );
  const request = useMemo(
    () => (tip ? { channel: "teamTips" as const, id: tip.id, priority: 40 } : null),
    [tip],
  );
  const { visible, release } = useSurfaceSlot(request);

  useEffect(() => {
    if (visible && tip) {
      setShown(tip.id);
      markSeen(tip.id);
    }
  }, [visible, tip, markSeen]);

  const close = useCallback(() => {
    release();
    setShown(null);
  }, [release]);

  if (!visible || !tip) return null;
  const feature = tip.featureId ? featureById(tip.featureId) : undefined;
  return (
    <DiscoveryNoteCard
      icon={Users}
      eyebrow="Tipp vom Team"
      title={tip.title}
      body={tip.body}
      onClose={close}
      actions={
        feature
          ? [
              {
                label: "Zeigen",
                onClick: () => {
                  close();
                  void highlightFeature(feature.id);
                },
              },
            ]
          : []
      }
    />
  );
}
