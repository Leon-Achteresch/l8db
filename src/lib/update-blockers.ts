import { listTransactions } from "@/lib/db";
import { isQueryTabDirty, useTableTabs } from "@/lib/table-tabs";
import { isTaskActive, useTasksStore } from "@/lib/tasks";
import { useTransactionStore } from "@/lib/transactions";

export interface UpdateBlockers {
  transactions: number;
  tasks: number;
  files: number;
}

async function openTransactionCount(): Promise<number> {
  try {
    return new Set(await listTransactions()).size;
  } catch {
    return useTransactionStore.getState().transactions.length;
  }
}

function dirtyFileCount(): number {
  const state = useTableTabs.getState();
  const dirty = new Set<string>();
  for (const tab of [...state.tabs, ...Object.values(state.tabsByConnection).flat()])
    if (tab.kind === "query" && isQueryTabDirty(tab)) dirty.add(tab.id);
  return dirty.size;
}

export async function collectUpdateBlockers(): Promise<UpdateBlockers> {
  return {
    transactions: await openTransactionCount(),
    tasks: useTasksStore.getState().tasks.filter(isTaskActive).length,
    files: dirtyFileCount(),
  };
}

export function describeUpdateBlockers(blockers: UpdateBlockers): string | null {
  const parts = [
    blockers.transactions === 1
      ? "1 offene Transaktion"
      : blockers.transactions > 1
        ? `${blockers.transactions} offene Transaktionen`
        : null,
    blockers.tasks === 1
      ? "1 laufende Aufgabe"
      : blockers.tasks > 1
        ? `${blockers.tasks} laufende Aufgaben`
        : null,
    blockers.files === 1
      ? "1 ungespeicherte Datei"
      : blockers.files > 1
        ? `${blockers.files} ungespeicherte Dateien`
        : null,
  ].filter((part): part is string => part !== null);
  return parts.length ? parts.join(" · ") : null;
}

export async function updateCanRelaunch(): Promise<boolean> {
  return describeUpdateBlockers(await collectUpdateBlockers()) === null;
}
