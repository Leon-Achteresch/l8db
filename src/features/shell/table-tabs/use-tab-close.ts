import type { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { saveQueryTabFile } from "@/lib/hooks/use-query-file";
import { finishManagedTransaction } from "@/lib/managed-transactions";
import { noteActiveTab, recentTabKeys } from "@/lib/recent-tabs";
import { standaloneTabs, tabAfterClose, useSplitView } from "@/lib/split-view";
import { commitStagedTable, discardStagedTable, isUserCancel } from "@/lib/staged-edits";
import { navigateToTab } from "@/lib/tab-navigation";
import { stagedTablesClosedWith, transactionsClosedWith } from "@/lib/tab-transactions";
import {
  queryNeedsCloseConfirmation,
  remoteTab,
  type Tab,
  tabKey,
  useTableTabs,
} from "@/lib/table-tabs";
import { useWorkbenchTabs, workbenchTabBusy } from "@/lib/workbench-tabs";

export type PendingClose = { keys: string[]; keep?: string; collapse?: boolean } | null;
export type PendingTransactionClose = {
  close: NonNullable<PendingClose>;
  txIds: string[];
  staged?: string[];
} | null;

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
  const [pendingTransactions, setPendingTransactions] = useState<PendingTransactionClose>(null);

  useEffect(() => {
    if (listen && activeTab) noteActiveTab(tabKey(activeTab));
  }, [activeTab, listen]);

  const executeClose = (pending: NonNullable<PendingClose>) => {
    const closing = new Set(pending.keys);
    const close = () => {
      if (pending.collapse) useSplitView.getState().collapse();
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
    const held = transactionsClosedWith(pending.keys);
    const staged = stagedTablesClosedWith(pending.keys);
    if (held.length || staged.length) {
      setPendingTransactions({ close: pending, txIds: held.map((tx) => tx.txId), staged });
      return;
    }
    confirmUnsaved(pending);
  };

  const confirmUnsaved = (pending: NonNullable<PendingClose>) => {
    const dirty = useTableTabs
      .getState()
      .tabs.some(
        (tab) =>
          pending.keys.includes(tabKey(tab)) &&
          tab.kind === "query" &&
          queryNeedsCloseConfirmation(tab),
      );
    if (dirty) setPendingClose(pending);
    else executeClose(pending);
  };

  const finishTransactions = async (commit: boolean) => {
    if (!pendingTransactions) return;
    const { close, txIds, staged = [] } = pendingTransactions;
    setPendingTransactions(null);
    try {
      for (const key of staged) {
        if (commit) await commitStagedTable(key);
        else discardStagedTable(key);
      }
      for (const txId of txIds) await finishManagedTransaction(txId, commit);
    } catch (error) {
      if (!isUserCancel(error)) toast.error(error instanceof Error ? error.message : String(error));
      return;
    }
    if (txIds.length)
      toast.success(commit ? "Transaktion committed." : "Transaktion zurückgerollt.");
    else toast.success(commit ? "Änderungen übernommen." : "Änderungen verworfen.");
    confirmUnsaved(close);
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

  const handleCloseGroup = (keys: string[]) => requestClose({ keys, collapse: true });

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
    pendingTransactions,
    setPendingTransactions,
    finishTransactions,
    pendingClose,
    setPendingClose,
    savingClose,
    saveAndClose,
    executeClose,
    handleClose,
    handleCloseOthers,
    handleCloseToRight,
    handleCloseAll,
    handleCloseGroup,
  };
}
