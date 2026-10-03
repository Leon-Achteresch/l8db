import { useNavigate } from "@tanstack/react-router";
import { WifiOff } from "lucide-react";
import { useEffect } from "react";
import { isMainWindow, useConnectionsStore } from "@/lib/connections";
import {
  countQuery,
  greetingMoment,
  islandName,
  milestoneMoment,
  onboardedMoment,
  productionQuip,
  showIslandMoment,
  takeVersionChange,
  taskMoment,
  versionMoment,
  welcomeBackMoment,
} from "@/lib/dynamic-island";
import { isProduction } from "@/lib/environments";
import { useSettingsStore } from "@/lib/settings";
import { useConnectionSwitch } from "@/lib/ssh";
import { isTaskActive, useTasksStore } from "@/lib/tasks";
import { getAppVersion } from "@/lib/updater";

const AWAY_MS = 30 * 60_000;
const QUERY_TASKS = new Set(["SQL-Abfrage", "SQL-Skript"]);

export function useIslandMoments() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    void Promise.all([islandName(), getAppVersion()]).then(([name, version]) => {
      if (cancelled) return;
      const updated = takeVersionChange(version);
      if (updated)
        showIslandMoment(versionMoment(updated, () => void navigate({ to: "/release-notes" })));
      else if (isMainWindow && useSettingsStore.getState().onboardingDone)
        showIslandMoment(greetingMoment(new Date(), name));
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    let awaySince: number | null = null;
    const leave = () => {
      if (!document.hidden && document.hasFocus()) return;
      awaySince ??= Date.now();
    };
    const back = () => {
      if (document.hidden || awaySince === null) return;
      const away = Date.now() - awaySince;
      awaySince = null;
      if (away >= AWAY_MS)
        void islandName().then((name) =>
          showIslandMoment(welcomeBackMoment(new Date(), name, away)),
        );
    };
    const visibility = () => (document.hidden ? leave() : back());
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(
    () =>
      useTasksStore.subscribe((state, previous) => {
        const running = new Set(previous.tasks.filter(isTaskActive).map((task) => task.id));
        for (const task of state.tasks) {
          if (!running.has(task.id) || isTaskActive(task)) continue;
          const done = taskMoment(task);
          if (done) showIslandMoment(done);
          if (task.status !== "success" || !QUERY_TASKS.has(task.title)) continue;
          const milestone = countQuery();
          if (milestone) showIslandMoment(milestoneMoment(milestone));
        }
      }),
    [],
  );

  useEffect(
    () =>
      useConnectionSwitch.subscribe((state, previous) => {
        if (!previous.isSwitching || state.isSwitching || !previous.targetId) return;
        const { activeId, connections } = useConnectionsStore.getState();
        const connection = connections.find((entry) => entry.id === previous.targetId);
        if (activeId !== previous.targetId || !isProduction(connection)) return;
        const quip = productionQuip(new Date());
        if (quip) showIslandMoment(quip);
      }),
    [],
  );

  useEffect(
    () =>
      useSettingsStore.subscribe((state, previous) => {
        if (state.onboardingDone && !previous.onboardingDone)
          void islandName().then((name) => showIslandMoment(onboardedMoment(name)));
      }),
    [],
  );

  useEffect(() => {
    const offline = () =>
      showIslandMoment({
        key: "network",
        glyph: { kind: "icon", icon: WifiOff },
        title: "Offline",
        detail: "Keine Internetverbindung",
        tone: "warning",
        duration: 4000,
      });
    const online = () =>
      showIslandMoment({
        key: "network",
        glyph: { kind: "check" },
        title: "Wieder online",
        tone: "success",
        duration: 2500,
      });
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, []);
}
