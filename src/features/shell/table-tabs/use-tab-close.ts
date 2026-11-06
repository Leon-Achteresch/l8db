import type { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { saveQueryTabFile } from "@/lib/hooks/use-query-file";
import { standaloneTabs, tabAfterClose, useSplitView } from "@/lib/split-view";
import { navigateToTab } from "@/lib/tab-navigation";
import {
  queryNeedsCloseConfirmation,
  remoteTab,
  type Tab,
  tabKey,
  useTableTabs,
} from "@/lib/table-tabs";
import { noteActiveTab, recentTabKeys } from "@/lib/ui-plugins/tabs-policy";
import { useWorkbenchTabs, workbenchTabBusy } from "@/lib/workbench-tabs";

export type PendingClose = { keys: string[]; keep?: string } | null;

interface UseTabCloseOptions {
  tabs: Tab[];
  activeTab: Tab | undefined;
  navigate: ReturnType<typeof useNavigate>;
  listen?: boolean;
}

function nextInList(tabs: Tab[], route: string, closing: Set<string>): Tab | undefined {
  const remaining = tabs.filter((tab) => !closing.has(tabKey(tab)));
  const recent = recentTabKeys().find((key) => remaining.some((tab) => tabKey(tab) === key));
  if (recent) return remaining.find((tab) => tabKey(tab) === recent);
  const index = tabs.findIndex((tab) => tabKey(tab) === route);
  return (
    tabs.slice(index + 1).find((tab) => !closing.has(tabKey(tab))) ??
    tabs
      .slice(0, Math.max(index, 0))
      .reverse()
      .find((tab) => !closing.has(tabKey(tab)))
  );
}

export function useTabClose({ tabs, activeTab, navigate, listen = true }: UseTabCloseOptions) {
  const [pendingClose, setPendingClose] = useState<PendingClose>(null);
  const [savingClose, setSavingClose] = useState(false);

  useEffect(() => {
    if (listen && activeTab) noteActiveTab(tabKey(activeTab));
  }, [activeTab, listen]);

  const executeClose = (pending: NonNullable<PendingClose>) => {
    const closing = new Set(pending.keys);
    const close = () => {
      useTableTabs.getState().closeTabs(pending.keys.filter((key) => !remoteTab(key)));
      for (const key of pending.keys) if (remoteTab(key)) useSplitView.getState().removeTab(key);
    };
    const route = activeTab ? tabKey(activeTab) : null;
    if (!activeTab || !route || !closing.has(route)) {
      close();
      return;
    }
    const all = useTableTabs.getState().tabs;
    const splitNext = tabAfterClose(closing);
    const splitTab = splitNext ? all.find((tab) => tabKey(tab) === splitNext) : undefined;
    const inSplit = useSplitView.getState().paneTabs.some((keys) => keys.includes(route));
    const next =
      (pending.keep && !closing.has(pending.keep)
        ? all.find((tab) => tabKey(tab) === pending.keep)
        : undefined) ??
      (inSplit
        ? (splitTab ??
          nextInList(standaloneTabs(all, useSplitView.getState().paneTabs), route, closing))
        : nextInList(splitTab ? [splitTab, ...tabs] : tabs, route, closing));
    const returnTo =
      activeTab.kind === "tool" && activeTab.tool === "workbench"
        ? useWorkbenchTabs.getState().entries.find((entry) => entry.id === activeTab.id)?.returnTo
        : undefined;
    void Promise.resolve(
      next ? navigateToTab(navigate, next) : navigate({ to: returnTo ?? "/" }),
    ).finally(close);
  };

  const saveAndClose = async () => {
    if (!pendingClose || savingClose) return;
    const pending = pendingClose;
    setSavingClose(true);
    try {
      for (const key of pending.keys) {
        const tab = useTableTabs.getState().tabs.find((entry) => tabKey(entry) === key);
        if (
          tab?.kind === "query" &&
          queryNeedsCloseConfirmation(tab) &&
          !(await saveQueryTabFile(tab.id))
        )
          return;
      }
      const changed = useTableTabs
        .getState()
        .tabs.some(
          (tab) =>
            pending.keys.includes(tabKey(tab)) &&
            tab.kind === "query" &&
            queryNeedsCloseConfirmation(tab),
        );
      if (changed) {
        toast.warning("Ein Entwurf wurde während des Speicherns geändert. Bitte erneut speichern.");
        return;
      }
      setPendingClose(null);
      executeClose(pending);
    } finally {
      setSavingClose(false);
    }
  };

  const requestClose = (pending: NonNullable<PendingClose>) => {
    if (pending.keys.length === 0) return;
    const closing = useTableTabs
      .getState()
      .tabs.filter((tab) => pending.keys.includes(tabKey(tab)));
    if (closing.some(workbenchTabBusy)) {
      toast.info("Die Aktion läuft noch. Warte, bis sie abgeschlossen ist.");
      return;
    }
    if (closing.some((tab) => tab.kind === "query" && queryNeedsCloseConfirmation(tab))) {
      setPendingClose(pending);
      return;
    }
    executeClose(pending);
  };

  const keysOf = (list: Tab[]) => list.map(tabKey);

  const handleClose = (tab: Tab) => requestClose({ keys: [tabKey(tab)] });

  const handleCloseOthers = (tab: Tab) =>
    requestClose({
      keys: keysOf(tabs.filter((entry) => tabKey(entry) !== tabKey(tab))),
      keep: tabKey(tab),
    });

  const handleCloseToRight = (tab: Tab) => {
    const index = tabs.findIndex((entry) => tabKey(entry) === tabKey(tab));
    requestClose({ keys: keysOf(tabs.slice(index + 1)), keep: tabKey(tab) });
  };

  const handleCloseAll = () => requestClose({ keys: keysOf(tabs) });

  useEffect(() => {
    if (!listen) return;
    const onCloseRequest = (event: Event) => {
      const key = (event as CustomEvent<string>).detail;
      const known =
        remoteTab(key) !== null ||
        useTableTabs.getState().tabs.some((entry) => tabKey(entry) === key);
      if (known) requestClose({ keys: [key] });
    };
    window.addEventListener("l8db:request-close-tab", onCloseRequest);
    return () => window.removeEventListener("l8db:request-close-tab", onCloseRequest);
  });

  return {
    pendingClose,
    setPendingClose,
    savingClose,
    saveAndClose,
    executeClose,
    handleClose,
    handleCloseOthers,
    handleCloseToRight,
    handleCloseAll,
  };
}
