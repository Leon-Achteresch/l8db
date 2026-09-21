import type { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { saveQueryTabFile } from "@/lib/hooks/use-query-file";
import { useSplitView } from "@/lib/split-view";
import { navigateToTab } from "@/lib/tab-navigation";
import { queryNeedsCloseConfirmation, type Tab, tabKey, useTableTabs } from "@/lib/table-tabs";

const tabHistory: string[] = [];

export type PendingClose =
  | { type: "tab" | "others" | "right"; key: string }
  | { type: "all" }
  | null;

interface UseTabCloseOptions {
  tabs: Tab[];
  activeTab: Tab | undefined;
  isTabActive: (tab: Tab) => boolean;
  navigate: ReturnType<typeof useNavigate>;
}

export function useTabClose({ tabs, activeTab, isTabActive, navigate }: UseTabCloseOptions) {
  const closeTab = useTableTabs((state) => state.closeTab);
  const collapse = useSplitView((state) => state.collapse);
  const closeVisibleTabs = (closing: Tab[]) => {
    for (const tab of closing) closeTab(tabKey(tab));
  };
  const closeAllTabs = () => {
    const state = useTableTabs.getState();
    if (tabs.length === state.tabs.length) state.closeAllTabs();
    else closeVisibleTabs(tabs);
  };
  const closeOtherTabs = (key: string) => {
    const state = useTableTabs.getState();
    if (tabs.length === state.tabs.length) state.closeOtherTabs(key);
    else closeVisibleTabs(tabs.filter((tab) => tabKey(tab) !== key));
  };
  const closeTabsToRight = (key: string) => {
    const state = useTableTabs.getState();
    if (tabs.length === state.tabs.length) state.closeTabsToRight(key);
    else closeVisibleTabs(tabs.slice(tabs.findIndex((tab) => tabKey(tab) === key) + 1));
  };
  const [pendingClose, setPendingClose] = useState<PendingClose>(null);

  const closeTabNow = (tab: Tab) => {
    const key = tabKey(tab);
    const wasActive = isTabActive(tab);
    if (!wasActive) {
      closeTab(key);
      return;
    }
    const index = tabs.findIndex((t) => tabKey(t) === key);
    const recent = tabHistory.find(
      (entry) => entry !== key && tabs.some((t) => tabKey(t) === entry),
    );
    const next = tabs.find((t) => tabKey(t) === recent) ?? tabs[index + 1] ?? tabs[index - 1];
    void Promise.resolve(next ? navigateToTab(navigate, next) : navigate({ to: "/" })).finally(() =>
      closeTab(key),
    );
  };

  useEffect(() => {
    if (!activeTab) return;
    const key = tabKey(activeTab);
    const at = tabHistory.indexOf(key);
    if (at !== -1) tabHistory.splice(at, 1);
    tabHistory.unshift(key);
    tabHistory.length = Math.min(tabHistory.length, 50);
  }, [activeTab]);

  const [savingClose, setSavingClose] = useState(false);
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);

  const saveAndClose = async () => {
    if (!pendingClose || savingClose) return;
    const pending = pendingClose;
    setSavingClose(true);
    try {
      for (const key of pendingKeys) {
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
            pendingKeys.includes(tabKey(tab)) &&
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

  const requestClose = (pending: NonNullable<typeof pendingClose>, closingTabs: Tab[]) => {
    if (closingTabs.some((tab) => tab.kind === "query" && queryNeedsCloseConfirmation(tab))) {
      setPendingKeys(closingTabs.map(tabKey));
      setPendingClose(pending);
      return;
    }
    executeClose(pending);
  };

  const executeClose = (pending: NonNullable<typeof pendingClose>) => {
    if (pending.type === "tab") {
      const tab = tabs.find((entry) => tabKey(entry) === pending.key);
      if (tab) closeTabNow(tab);
      return;
    }
    if (pending.type === "others") {
      const tab = tabs.find((entry) => tabKey(entry) === pending.key);
      if (tab) closeOthersNow(tab);
      return;
    }
    if (pending.type === "right") {
      const tab = tabs.find((entry) => tabKey(entry) === pending.key);
      if (tab) closeToRightNow(tab);
      return;
    }
    collapse();
    void navigate({ to: "/" }).finally(closeAllTabs);
  };

  const handleClose = (tab: Tab) => {
    const key = tabKey(tab);
    requestClose({ type: "tab", key }, [tab]);
  };

  const closeOthersNow = (tab: Tab) => {
    void Promise.resolve(navigateToTab(navigate, tab)).finally(() => closeOtherTabs(tabKey(tab)));
  };

  const closeToRightNow = (tab: Tab) => {
    const index = tabs.findIndex((t) => tabKey(t) === tabKey(tab));
    const remaining = tabs.slice(0, index + 1);
    if (activeTab && !remaining.some((t) => tabKey(t) === tabKey(activeTab))) {
      void Promise.resolve(navigateToTab(navigate, tab)).finally(() =>
        closeTabsToRight(tabKey(tab)),
      );
      return;
    }
    closeTabsToRight(tabKey(tab));
  };

  const handleCloseOthers = (tab: Tab) => {
    const key = tabKey(tab);
    requestClose(
      { type: "others", key },
      tabs.filter((entry) => tabKey(entry) !== key),
    );
  };

  const handleCloseToRight = (tab: Tab) => {
    const index = tabs.findIndex((entry) => tabKey(entry) === tabKey(tab));
    requestClose({ type: "right", key: tabKey(tab) }, tabs.slice(index + 1));
  };

  const handleCloseAll = () => {
    requestClose({ type: "all" }, tabs);
  };

  useEffect(() => {
    const onCloseRequest = (event: Event) => {
      const key = (event as CustomEvent<string>).detail;
      const tab = useTableTabs.getState().tabs.find((entry) => tabKey(entry) === key);
      if (tab) requestClose({ type: "tab", key }, [tab]);
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
