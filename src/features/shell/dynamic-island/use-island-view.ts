import { useEffect, useState, useSyncExternalStore } from "react";
import { useShallow } from "zustand/shallow";
import { useConnectionsStore } from "@/lib/connections";
import { ISLAND_TASK_DELAY, type IslandView, useIslandStore } from "@/lib/dynamic-island";
import { connectionEnvironment, environmentInfo } from "@/lib/environments";
import { useUpdatePrompt } from "@/lib/hooks/use-update-prompt";
import { useConnectionSwitch } from "@/lib/ssh";
import { isQueryTask, isTaskActive, useTasksStore } from "@/lib/tasks";
import { useTransactionStore } from "@/lib/transactions";
import { getInstallPercent, subscribeUpdatePrompt } from "@/lib/updater";

const TRANSACTION_COLOR = "#f59e0b";

function useShownAfter(active: boolean, delay: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(false);
    if (!active) return;
    const timer = window.setTimeout(() => setShown(true), delay);
    return () => window.clearTimeout(timer);
  }, [active, delay]);
  return active && shown;
}

export function useIslandView(): IslandView {
  const installPercent = useSyncExternalStore(
    subscribeUpdatePrompt,
    getInstallPercent,
    getInstallPercent,
  );
  const updateVersion = useUpdatePrompt().update?.version;
  const moment = useIslandStore((state) => state.queue[0]);
  const switching = useConnectionSwitch((state) => state.isSwitching);
  const targetId = useConnectionSwitch((state) => state.targetId);
  const target = useConnectionsStore((state) =>
    state.connections.find((entry) => entry.id === targetId),
  );
  const task = useTasksStore(
    useShallow((state) => {
      const active = state.tasks.filter((entry) => isTaskActive(entry) && !isQueryTask(entry));
      const last = active.at(-1);
      return {
        id: last?.id,
        title: last?.title,
        status: last?.status,
        connectionName: last?.connectionName,
        startedAt: last?.startedAt,
        percent: last?.total
          ? Math.min(100, Math.round(((last.progress ?? 0) / last.total) * 100))
          : undefined,
        count: active.length,
      };
    }),
  );
  const transactions = useTransactionStore((state) => state.transactions.length);
  const showSwitch = useShownAfter(switching, 250);
  const showTask = useShownAfter(task.id !== undefined, ISLAND_TASK_DELAY);

  if (installPercent !== null)
    return {
      key: "update",
      glyph: installPercent > 0 ? { kind: "ring", percent: installPercent } : { kind: "wave" },
      title: installPercent >= 100 ? "Update wird installiert" : "Update wird geladen",
      detail: updateVersion ? `v${updateVersion}` : undefined,
      percent: installPercent > 0 && installPercent < 100 ? installPercent : undefined,
    };
  if (moment) return moment;
  if (showSwitch)
    return {
      key: `switch:${targetId}`,
      glyph: { kind: "wave", color: environmentInfo(connectionEnvironment(target))?.color },
      title: target ? `Verbinde mit ${target.name}` : "Trenne Verbindung",
    };
  if (showTask && task.id !== undefined) {
    const { percent } = task;
    return {
      key: `task:${task.id}`,
      glyph: percent === undefined ? { kind: "wave" } : { kind: "ring", percent },
      title: task.status === "cancelling" ? "Wird abgebrochen" : (task.title ?? ""),
      detail: task.connectionName,
      since: percent === undefined ? task.startedAt : undefined,
      percent,
      more: task.count > 1 ? task.count - 1 : undefined,
    };
  }
  if (transactions)
    return {
      key: "idle:transaction",
      idle: true,
      glyph: { kind: "dot", color: TRANSACTION_COLOR },
      title: "Suchen",
      label: `Suchen · ${transactions === 1 ? "1 offene Transaktion" : `${transactions} offene Transaktionen`}`,
    };
  return { key: "idle", idle: true, glyph: { kind: "search" }, title: "Suchen" };
}
