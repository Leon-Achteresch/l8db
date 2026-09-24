import type { StoreApi } from "zustand";
import type { ToolId } from "@/lib/tool-tabs";
import type { BookmarkSlots } from "./query-tabs";

export type TableTab = {
  kind: "table";
  schema: string;
  table: string;
  entityType?: "table" | "view";
};
export type QueryTab = {
  kind: "query";
  id: string;
  title: string;
  sql: string;
  lastExecutedSql?: string;
  filePath?: string;
  savedSql?: string;
  fileMtime?: number | null;
  externalChange?: boolean;
  bookmarks?: number[];
  bookmarkSlots?: BookmarkSlots;
  autoRun?: boolean;
};
export type QueryFileInfo = { path: string; mtime: number | null; savedSql?: string };

export type FunctionTab = { kind: "function"; schema: string; name: string; oid: string };
export type ProcedureTab = { kind: "procedure"; schema: string; name: string; oid: string };
export type ExtensionTab = { kind: "extension"; name: string };
export type ExtensionPanelTab = {
  kind: "extension-panel";
  extensionId: string;
  panelId: string;
  title: string;
};
export type RoleTab = { kind: "role"; name: string };
export type TriggerTab = { kind: "trigger"; schema: string; table: string; trigger: string };
export type ViewEditorTab = { kind: "view-editor"; schema: string; view: string };
export type AlterTableTab = { kind: "alter-table"; schema: string; table: string };
export type PackageTab = { kind: "package"; schema: string; name: string };
export interface CompareWorkspace {
  mode?: "definitions" | "data";
  dataLeft?: import("@/features/compare/data-compare-side-picker").DataCompareSideSelection;
  dataRight?: import("@/features/compare/data-compare-side-picker").DataCompareSideSelection;
  left: import("@/lib/compare-types").CompareSideSelection;
  right: import("@/lib/compare-types").CompareSideSelection;
  draft: string | null;
  draftBase?: string | null;
  sourceBase?: string | null;
  onlyDifferences: boolean;
}
export type ToolTab = {
  kind: "tool";
  tool: ToolId;
  id?: string;
  title?: string;
  compare?: CompareWorkspace;
};
export type Tab =
  | TableTab
  | QueryTab
  | FunctionTab
  | ProcedureTab
  | ExtensionTab
  | ExtensionPanelTab
  | RoleTab
  | TriggerTab
  | ViewEditorTab
  | AlterTableTab
  | PackageTab
  | ToolTab;

export type ClosedTab = Tab & {
  recoveryId?: string;
  closedAt?: number;
  closedConnectionId?: string | null;
  closedConnectionName?: string;
  closedDatabase?: string | null;
};

export interface TabsState {
  tabs: Tab[];
  tabsByConnection: Record<string, Tab[]>;
  recentlyClosed: ClosedTab[];
  openTab: (tab: Omit<TableTab, "kind">) => void;
  openQueryTab: () => string;
  openQueryTabWithSql: (sql: string, title?: string, autoRun?: boolean) => string;
  openSavedQueryTab: (tab: { id: string; title: string; sql: string }) => void;
  openFunctionTab: (tab: Omit<FunctionTab, "kind">) => void;
  openProcedureTab: (tab: Omit<ProcedureTab, "kind">) => void;
  openExtensionTab: (tab: Omit<ExtensionTab, "kind">) => void;
  openExtensionPanel: (tab: Omit<ExtensionPanelTab, "kind">) => void;
  openRoleTab: (tab: Omit<RoleTab, "kind">) => void;
  openTriggerTab: (tab: Omit<TriggerTab, "kind">) => void;
  openViewEditorTab: (tab: Omit<ViewEditorTab, "kind">) => void;
  openAlterTableTab: (tab: Omit<AlterTableTab, "kind">) => void;
  openPackageTab: (tab: Omit<PackageTab, "kind">) => void;
  openToolTab: (tool: ToolId, id?: string) => void;
  updateCompareTab: (id: string, compare: CompareWorkspace, title: string) => void;
  closeTab: (key: string) => void;
  closeOtherTabs: (key: string) => void;
  closeTabsToRight: (key: string) => void;
  closeAllTabs: () => void;
  reopenLastTab: () => Tab | null;
  reopenClosedTab: (id: string) => Tab | null;
  forgetClosedTab: (id: string) => void;
  clearTabsForConnection: (connectionId: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  updateQuerySql: (id: string, sql: string) => void;
  markQueryTabExecuted: (id: string, sql: string) => void;
  openFileQueryTab: (file: QueryFileInfo & { sql: string; title: string }) => string;
  bindQueryTabFile: (id: string, file: QueryFileInfo & { title: string }) => void;
  markQueryTabSaved: (id: string, mtime: number | null, savedSql?: string) => void;
  setQueryTabExternalChange: (id: string, changed: boolean, mtime?: number | null) => void;
  reloadQueryTabFromFile: (id: string, sql: string, mtime: number | null) => void;
  toggleQueryBookmark: (id: string, line: number) => void;
  setQueryBookmarks: (id: string, lines: number[]) => void;
  setQueryBookmarkSlot: (id: string, slot: number, line: number | null) => void;
  clearQueryBookmarks: (id: string) => void;
}

export type TabsSet = StoreApi<TabsState>["setState"];
export type TabsGet = StoreApi<TabsState>["getState"];
