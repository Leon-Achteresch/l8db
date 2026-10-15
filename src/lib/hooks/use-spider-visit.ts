import { type RefObject, useEffect } from "react";
import { useActiveConnectionId, useConnectionsStore } from "@/lib/connections";
import { isProduction } from "@/lib/environments";
import {
  claimSpiderVisit,
  isHalloween,
  leaveSpider,
  SPIDER_DELAY_MS,
  spiderVisitedToday,
  useSeasonalStore,
  visitSpider,
} from "@/lib/seasonal";
import { useSettingsStore } from "@/lib/settings";

export function useSpiderVisit(
  scrollRef: RefObject<HTMLElement | null>,
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
) {
  const enabled = useSettingsStore((state) => state.seasonalAccents);
  const connectionId = useActiveConnectionId();
  useEffect(() => {
    if (!enabled || !isHalloween(new Date()) || spiderVisitedToday()) return;
    let cancelled = false;
    let visit = 0;
    const timer = window.setTimeout(() => {
      const element = scrollRef.current;
      if (
        !element ||
        document.visibilityState !== "visible" ||
        !document.hasFocus() ||
        useSeasonalStore.getState().visit ||
        element.closest('[role="dialog"],[role="alertdialog"]')
      )
        return;
      const { connections } = useConnectionsStore.getState();
      if (isProduction(connections.find((connection) => connection.id === connectionId))) return;
      const rect = element.getBoundingClientRect();
      const spot = {
        x: Math.max(rect.left + 48, rect.right - 120),
        top: rect.top,
        y: rect.top + Math.min(150, Math.max(64, rect.height * 0.3)),
      };
      if (
        rect.width < 320 ||
        rect.height < 160 ||
        !element.contains(document.elementFromPoint(spot.x, spot.y + 22)) ||
        !claimSpiderVisit()
      )
        return;
      void import("@/lib/spider-quip").then(({ spiderQuip }) => {
        if (!cancelled) visit = visitSpider(spot, spiderQuip(columns, rows));
      });
    }, SPIDER_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (visit) leaveSpider(visit);
    };
  }, [enabled, connectionId, scrollRef, columns, rows]);
}
