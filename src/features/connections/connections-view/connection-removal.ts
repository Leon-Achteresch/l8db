import { useConnectionsStore } from "@/lib/connections";
import { connectionInOtherWindow } from "@/lib/db";
import { queryNeedsCloseConfirmation, type Tab, useTableTabs } from "@/lib/table-tabs";
import { getTransactionForConnection } from "@/lib/transactions";

export async function connectionRemovalBlocker(ids: string[]): Promise<string | null> {
  if (ids.some((id) => getTransactionForConnection(id)))
    return ids.length > 1
      ? "Schließe zuerst die offenen Transaktionen ab."
      : "Schließe zuerst die offene Transaktion ab.";
  const shared = await Promise.all(ids.map((id) => connectionInOtherWindow(id).catch(() => false)));
  if (shared.some(Boolean))
    return ids.length > 1
      ? "Eine dieser Verbindungen ist in einem anderen Fenster aktiv. Trenne sie dort zuerst."
      : "Die Verbindung ist in einem anderen Fenster aktiv. Trenne sie dort zuerst.";
  return null;
}

export function unsavedQueryTabCount(ids: string[]): number {
  const { tabs, tabsByConnection } = useTableTabs.getState();
  const activeId = useConnectionsStore.getState().activeId;
  return ids
    .flatMap((id): Tab[] => (id === activeId ? tabs : (tabsByConnection[id] ?? [])))
    .filter((tab) => tab.kind === "query" && queryNeedsCloseConfirmation(tab)).length;
}

export function unsavedQueryTabsNotice(count: number): string {
  if (count === 0) return "";
  return count === 1
    ? " Ein Query-Tab mit nicht gespeichertem SQL wird dabei geschlossen und lässt sich nicht wiederherstellen."
    : ` ${count} Query-Tabs mit nicht gespeichertem SQL werden dabei geschlossen und lassen sich nicht wiederherstellen.`;
}
