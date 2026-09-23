import { useEffect, useState } from "react";
import { useSonner } from "sonner";
import { FeatureVideoCard } from "@/features/updates/feature-video-card";
import { useFeatureVideoStore } from "@/lib/feature-videos/store";
import { useFeatureVideos } from "@/lib/feature-videos/use-feature-videos";
import { useSettingsStore } from "@/lib/settings";
import { useTourStore } from "@/lib/tour/store";

export function FeatureVideoHost() {
  const { items } = useFeatureVideos();
  const { activeId, manual, sessionUsed, history, open, close } = useFeatureVideoStore();
  const enabled = useSettingsStore((s) => s.autoFeatureVideos);
  const onboardingDone = useSettingsStore((s) => s.onboardingDone);
  const tourActive = useTourStore((s) => s.active || s.offerOpen);
  const { toasts } = useSonner();
  const urgent = toasts.some(
    (toast) => !toast.delete && (toast.type === "error" || toast.type === "warning"),
  );
  const [environment, setEnvironment] = useState({ blocked: true, idle: false, ready: false });

  useEffect(() => {
    const start = Date.now();
    let lastInput = start;
    const input = () => {
      lastInput = Date.now();
    };
    const inspect = () => {
      const dialogs = [
        ...document.querySelectorAll('[role="dialog"], [role="alertdialog"], .driver-popover'),
      ];
      const blocked =
        document.hidden ||
        !document.hasFocus() ||
        dialogs.some((node) => node.getClientRects().length > 0);
      const next = {
        blocked,
        idle:
          Date.now() - lastInput > 2500 &&
          !document.activeElement?.matches('input, textarea, [contenteditable="true"]'),
        ready: Date.now() - start >= 10_000,
      };
      setEnvironment((previous) =>
        previous.blocked === next.blocked &&
        previous.idle === next.idle &&
        previous.ready === next.ready
          ? previous
          : next,
      );
    };
    document.addEventListener("keydown", input, true);
    document.addEventListener("pointerdown", input, true);
    document.addEventListener("visibilitychange", inspect);
    const timer = window.setInterval(inspect, 500);
    return () => {
      clearInterval(timer);
      document.removeEventListener("keydown", input, true);
      document.removeEventListener("pointerdown", input, true);
      document.removeEventListener("visibilitychange", inspect);
    };
  }, []);

  const suspended = environment.blocked || !onboardingDone || tourActive || urgent;
  useEffect(() => {
    if (!enabled && activeId && !manual) close();
    if (
      activeId ||
      sessionUsed ||
      !enabled ||
      import.meta.env.DEV ||
      suspended ||
      !environment.ready ||
      !environment.idle
    )
      return;
    const candidate = items.slice(0, 3).find((item) => !history[item.id]);
    if (candidate) open(candidate.id);
  }, [activeId, manual, sessionUsed, enabled, suspended, environment, history, items, open, close]);

  const index = items.findIndex((item) => item.id === activeId);
  const item = items[index];
  useEffect(() => {
    if (activeId && !item) close();
  }, [activeId, item, close]);
  if (!item) return null;
  return (
    <FeatureVideoCard
      key={`${item.id}:${item.revision}`}
      item={item}
      suspended={suspended}
      next={items[index + 1]}
    />
  );
}
