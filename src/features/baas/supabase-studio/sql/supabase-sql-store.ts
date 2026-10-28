import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createBufferedJsonStorage } from "@/lib/buffered-storage";
import { syncAcrossWindows } from "@/lib/window-sync";

export interface SupabaseSqlTab {
  id: string;
  title: string;
  sql: string;
}

export interface SupabaseSqlHistoryEntry {
  id: string;
  sql: string;
  at: number;
  ok: boolean;
  rows: number | null;
  durationMs: number | null;
}

export interface SupabaseSqlSnippet {
  id: string;
  name: string;
  sql: string;
}

export interface SupabaseSqlProjectState {
  tabs: SupabaseSqlTab[];
  activeTab: string;
  history: SupabaseSqlHistoryEntry[];
  snippets: SupabaseSqlSnippet[];
  readOnly: boolean;
}

const HISTORY_LIMIT = 50;
const HISTORY_SQL_LIMIT = 20_000;
const STORAGE_KEY = "l8db.supabase-studio-sql";

const newTab = (index: number, sql = ""): SupabaseSqlTab => ({
  id: crypto.randomUUID(),
  title: `Abfrage ${index}`,
  sql,
});

export function emptySupabaseSqlProject(): SupabaseSqlProjectState {
  const tab = newTab(1);
  return { tabs: [tab], activeTab: tab.id, history: [], snippets: [], readOnly: false };
}

export function appendSupabaseSqlHistory(
  history: SupabaseSqlHistoryEntry[],
  entry: Omit<SupabaseSqlHistoryEntry, "id">,
): SupabaseSqlHistoryEntry[] {
  const sql = entry.sql.slice(0, HISTORY_SQL_LIMIT);
  return [
    { ...entry, sql, id: crypto.randomUUID() },
    ...history.filter((item) => item.sql !== sql),
  ].slice(0, HISTORY_LIMIT);
}

interface SupabaseSqlStore {
  projects: Record<string, SupabaseSqlProjectState>;
  update: (
    reference: string,
    change: (project: SupabaseSqlProjectState) => Partial<SupabaseSqlProjectState>,
    initial: SupabaseSqlProjectState,
  ) => void;
}

export const useSupabaseSqlStore = create<SupabaseSqlStore>()(
  persist(
    (set) => ({
      projects: {},
      update: (reference, change, initial) =>
        set((state) => {
          const current = state.projects[reference] ?? initial;
          return {
            projects: { ...state.projects, [reference]: { ...current, ...change(current) } },
          };
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: createBufferedJsonStorage(() => window.localStorage),
      partialize: (state) => ({ projects: state.projects }),
    },
  ),
);

syncAcrossWindows(STORAGE_KEY, () => void useSupabaseSqlStore.persist.rehydrate());

export function addSupabaseSqlTab(project: SupabaseSqlProjectState, sql = "") {
  const tab = newTab(project.tabs.length + 1, sql);
  return { tabs: [...project.tabs, tab], activeTab: tab.id };
}

export function closeSupabaseSqlTab(project: SupabaseSqlProjectState, id: string) {
  const tabs = project.tabs.filter((tab) => tab.id !== id);
  if (!tabs.length) return addSupabaseSqlTab({ ...project, tabs: [] });
  const index = project.tabs.findIndex((tab) => tab.id === id);
  return {
    tabs,
    activeTab: project.activeTab === id ? tabs[Math.max(0, index - 1)].id : project.activeTab,
  };
}
