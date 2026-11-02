import { isQueryTabDirty, type Tab } from "@/lib/table-tabs";

export type DirtyFile = { id: string; title: string; connectionId: string | null; active: boolean };

export function dirtyQueryFiles(
  tabs: Tab[],
  tabsByConnection: Record<string, Tab[]>,
  activeId: string | null,
): DirtyFile[] {
  const seen = new Set<string>();
  const files: DirtyFile[] = [];
  const collect = (list: Tab[], connectionId: string | null, active: boolean) => {
    for (const tab of list) {
      if (tab.kind !== "query" || !isQueryTabDirty(tab) || seen.has(tab.id)) continue;
      seen.add(tab.id);
      files.push({ id: tab.id, title: tab.title, connectionId, active });
    }
  };
  collect(tabs, activeId, true);
  for (const [connectionId, list] of Object.entries(tabsByConnection))
    collect(list, connectionId, false);
  return files;
}
