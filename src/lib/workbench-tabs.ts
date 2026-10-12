import type { ReactNode } from "react";
import { create } from "zustand";
import { tabKey, useTableTabs } from "@/lib/table-tabs";

export interface WorkbenchEntry {
  id: string;
  title: string;
  connectionId: string | null;
  database: string | null;
  content: ReactNode;
  container: HTMLDivElement;
  busy: boolean;
  returnTo: string;
}

export const useWorkbenchTabs = create<{ entries: WorkbenchEntry[] }>(() => ({ entries: [] }));

export function isWorkbenchTab(tab: import("@/lib/table-tabs").Tab): boolean {
  return tab.kind === "tool" && tab.tool === "workbench";
}

export function addWorkbenchTab(entry: WorkbenchEntry): void {
  useWorkbenchTabs.setState((state) => ({ entries: [...state.entries, entry] }));
  useTableTabs.getState().openToolTab("workbench", entry.id);
  useTableTabs.setState((state) => {
    const update = (tabs: typeof state.tabs) =>
      tabs.map((tab) =>
        isWorkbenchTab(tab) && tab.kind === "tool" && tab.id === entry.id
          ? { ...tab, title: entry.title }
          : tab,
      );
    return {
      tabs: update(state.tabs),
      tabsByConnection: Object.fromEntries(
        Object.entries(state.tabsByConnection).map(([key, tabs]) => [key, update(tabs)]),
      ),
    };
  });
}

export function setWorkbenchBusy(id: string, busy: boolean): void {
  useWorkbenchTabs.setState((state) => ({
    entries: state.entries.map((entry) => (entry.id === id ? { ...entry, busy } : entry)),
  }));
}

export function workbenchTabBusy(tab: import("@/lib/table-tabs").Tab): boolean {
  return (
    isWorkbenchTab(tab) &&
    tab.kind === "tool" &&
    useWorkbenchTabs.getState().entries.some((entry) => entry.id === tab.id && entry.busy)
  );
}

export function closeWorkbenchTab(id: string): void {
  const tab = useTableTabs
    .getState()
    .tabs.find((tab) => isWorkbenchTab(tab) && tab.kind === "tool" && tab.id === id);
  if (tab) setWorkbenchBusy(id, false);
  if (tab) window.dispatchEvent(new CustomEvent("l8db:request-close-tab", { detail: tabKey(tab) }));
}

useTableTabs.subscribe((state) => {
  const ids = new Set(
    [...state.tabs, ...Object.values(state.tabsByConnection).flat()]
      .filter(isWorkbenchTab)
      .map((tab) => (tab.kind === "tool" ? tab.id : undefined)),
  );
  const entries = useWorkbenchTabs.getState().entries;
  if (entries.some((entry) => !ids.has(entry.id))) {
    useWorkbenchTabs.setState({ entries: entries.filter((entry) => ids.has(entry.id)) });
  }
});
