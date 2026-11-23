import { useConnectionsStore } from "@/lib/connections";
import { paneConnectionId, useSplitView } from "@/lib/split-view";
import { type StagedTarget, useStagedEdits } from "@/lib/staged-edits";
import { remoteTab, type Tab, tabKey, useTableTabs } from "@/lib/table-tabs";
import { keyForConnection } from "@/lib/table-tabs/tab-keys";
import { type ActiveTransaction, useTransactionStore } from "@/lib/transactions";

export interface OpenTab {
  key: string;
  tab: Tab;
  connectionId: string | null;
}

export function tabHoldsTransaction(
  tab: Tab,
  connectionId: string | null,
  tx: ActiveTransaction,
): boolean {
  if (!connectionId || tx.connectionId !== connectionId) return false;
  const scope = tx.scope ?? { type: "connection" };
  if (tab.kind === "table") {
    if (scope.type === "table") return scope.schema === tab.schema && scope.table === tab.table;
    return tx.changes.some((change) => change.schema === tab.schema && change.table === tab.table);
  }
  if (tab.kind !== "query" || scope.type === "table") return false;
  return (
    scope.type === "query" ||
    tx.changes.length === 0 ||
    tx.changes.some((change) => change.type === "query")
  );
}

export function tabHasTransaction(
  tab: Tab,
  connectionId: string | null,
  transactions: ActiveTransaction[],
): boolean {
  return transactions.some((tx) => tabHoldsTransaction(tab, connectionId, tx));
}

export function orphanedTransactions(
  closing: OpenTab[],
  remaining: OpenTab[],
  transactions: ActiveTransaction[],
): ActiveTransaction[] {
  return transactions.filter(
    (tx) =>
      closing.some((entry) => tabHoldsTransaction(entry.tab, entry.connectionId, tx)) &&
      !remaining.some((entry) => tabHoldsTransaction(entry.tab, entry.connectionId, tx)),
  );
}

export function tabHoldsStagedTable(
  tab: Tab,
  connectionId: string | null,
  entry: StagedTarget,
): boolean {
  return (
    tab.kind === "table" &&
    connectionId === entry.connectionId &&
    tab.schema === entry.schema &&
    tab.table === entry.table
  );
}

export function tabHasStagedChanges(
  tab: Tab,
  connectionId: string | null,
  tables: Record<string, StagedTarget>,
): boolean {
  for (const key in tables) if (tabHoldsStagedTable(tab, connectionId, tables[key])) return true;
  return false;
}

export function transactionsClosedWith(keys: string[]): ActiveTransaction[] {
  const { transactions } = useTransactionStore.getState();
  if (!transactions.length || !keys.length) return [];
  const { closing, remaining } = closeSets(keys);
  return orphanedTransactions(closing, remaining, transactions);
}

export function stagedTablesClosedWith(keys: string[]): string[] {
  const { tables } = useStagedEdits.getState();
  const entries = Object.entries(tables);
  if (!entries.length || !keys.length) return [];
  const { closing, remaining } = closeSets(keys);
  return entries
    .filter(
      ([, entry]) =>
        closing.some((item) => tabHoldsStagedTable(item.tab, item.connectionId, entry)) &&
        !remaining.some((item) => tabHoldsStagedTable(item.tab, item.connectionId, entry)),
    )
    .map(([key]) => key);
}

function closeSets(keys: string[]): { closing: OpenTab[]; remaining: OpenTab[] } {
  const { activeId, connections } = useConnectionsStore.getState();
  const split = useSplitView.getState();
  const { tabs, tabsByConnection } = useTableTabs.getState();
  const closable: OpenTab[] = tabs.map((tab) => ({
    key: tabKey(tab),
    tab,
    connectionId: paneConnectionId(split, tabKey(tab), activeId, connections) ?? activeId,
  }));
  for (const key of new Set([...split.paneTabs.flat(), ...keys])) {
    const tab = remoteTab(key);
    if (tab?.connectionId) closable.push({ key, tab, connectionId: tab.connectionId });
  }
  const closingKeys = new Set(keys);
  const others = Object.entries(tabsByConnection)
    .filter(([id]) => id !== keyForConnection(activeId))
    .flatMap(([id, list]) => list.map((tab) => ({ key: tabKey(tab), tab, connectionId: id })));
  return {
    closing: closable.filter((entry) => closingKeys.has(entry.key)),
    remaining: [...closable.filter((entry) => !closingKeys.has(entry.key)), ...others],
  };
}
