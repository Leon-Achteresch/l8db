import { listTransactions } from "@/lib/db";
import { isQueryTabDirty, useTableTabs } from "@/lib/table-tabs";
import { isTaskActive, useTasksStore } from "@/lib/tasks";
import { useTransactionStore } from "@/lib/transactions";

export interface UpdateBlockers {
  transactions: number;
  tasks: number;
  files: number;
}

const WINDOW_TASKS_PREFIX = "l8db.window-tasks:";
const WINDOW_TASKS_REFRESH_MS = 10_000;
const WINDOW_TASKS_STALE_MS = 120_000;

const windowTasksKey = `${WINDOW_TASKS_PREFIX}${
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
}`;

let publishedCount = 0;
let publishedAt = 0;
let refreshTimer: ReturnType<typeof setInterval> | undefined;

function localActiveTaskCount(): number {
  return useTasksStore.getState().tasks.filter(isTaskActive).length;
}

function sharedStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function withdrawWindowTasks(): void {
  clearInterval(refreshTimer);
  refreshTimer = undefined;
  publishedCount = 0;
  try {
    sharedStorage()?.removeItem(windowTasksKey);
  } catch {}
}

function publishWindowTasks(force = false): void {
  const count = localActiveTaskCount();
  if (count === 0) {
    if (publishedCount !== 0 || refreshTimer) withdrawWindowTasks();
    return;
  }
  const now = Date.now();
  if (!force && count === publishedCount && now - publishedAt < WINDOW_TASKS_REFRESH_MS) return;
  try {
    sharedStorage()?.setItem(windowTasksKey, JSON.stringify({ count, at: now }));
    publishedCount = count;
    publishedAt = now;
  } catch {
    return;
  }
  refreshTimer ??= setInterval(() => publishWindowTasks(true), WINDOW_TASKS_REFRESH_MS);
}

function otherWindowTaskCount(): number {
  const storage = sharedStorage();
  if (!storage || typeof storage.key !== "function") return 0;
  const now = Date.now();
  let total = 0;
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(WINDOW_TASKS_PREFIX) || key === windowTasksKey) continue;
    try {
      const entry = JSON.parse(storage.getItem(key) ?? "null") as {
        count?: unknown;
        at?: unknown;
      } | null;
      if (
        typeof entry?.count === "number" &&
        typeof entry.at === "number" &&
        now - entry.at < WINDOW_TASKS_STALE_MS
      )
        total += entry.count;
    } catch {}
  }
  return total;
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  useTasksStore.subscribe(() => publishWindowTasks());
  window.addEventListener("pagehide", withdrawWindowTasks);
  window.addEventListener("beforeunload", withdrawWindowTasks);
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
    tasks: localActiveTaskCount() + otherWindowTaskCount(),
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
