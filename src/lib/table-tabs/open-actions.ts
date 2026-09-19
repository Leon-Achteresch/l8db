import { nextQueryTitle, storeFor } from "./helpers";
import { tabKey } from "./tab-keys";
import type {
  AlterTableTab,
  ExtensionPanelTab,
  ExtensionTab,
  FunctionTab,
  PackageTab,
  ProcedureTab,
  QueryTab,
  RoleTab,
  TableTab,
  TabsGet,
  TabsSet,
  TabsState,
  ToolTab,
  TriggerTab,
  ViewEditorTab,
} from "./types";

export function createOpenActions(
  set: TabsSet,
  get: TabsGet,
): Pick<
  TabsState,
  | "openTab"
  | "openQueryTab"
  | "openQueryTabWithSql"
  | "openSavedQueryTab"
  | "openProcedureTab"
  | "openFunctionTab"
  | "openExtensionTab"
  | "openExtensionPanel"
  | "openPackageTab"
  | "openToolTab"
  | "updateCompareTab"
  | "openRoleTab"
  | "openTriggerTab"
  | "openViewEditorTab"
  | "openAlterTableTab"
> {
  return {
    openTab: (tab) => {
      const tableTab: TableTab = {
        kind: "table",
        schema: tab.schema,
        table: tab.table,
        entityType: tab.entityType ?? "table",
      };
      const key = tabKey(tableTab);
      set((state) => {
        const index = state.tabs.findIndex((t) => tabKey(t) === key);
        if (index === -1) {
          return storeFor([...state.tabs, tableTab], state);
        }
        const existing = state.tabs[index];
        if (existing.kind === "table" && (existing.entityType ?? "table") === tableTab.entityType) {
          return state;
        }
        const tabs = [...state.tabs];
        tabs[index] = tableTab;
        return storeFor(tabs, state);
      });
    },

    openQueryTab: () => {
      const qt: QueryTab = {
        kind: "query",
        id: crypto.randomUUID(),
        title: nextQueryTitle(get().tabs),
        sql: "",
      };
      set((state) => storeFor([...state.tabs, qt], state));
      return qt.id;
    },

    openQueryTabWithSql: (sql, title, autoRun) => {
      const qt: QueryTab = {
        kind: "query",
        id: crypto.randomUUID(),
        title: title ?? nextQueryTitle(get().tabs),
        sql,
        autoRun,
      };
      set((state) => storeFor([...state.tabs, qt], state));
      return qt.id;
    },

    openSavedQueryTab: (tab) => {
      set((state) => {
        if (state.tabs.some((t) => t.kind === "query" && t.id === tab.id)) return state;
        return storeFor([...state.tabs, { kind: "query", ...tab }], state);
      });
    },

    openProcedureTab: (tab) => {
      const pr: ProcedureTab = { kind: "procedure", ...tab };
      const key = tabKey(pr);
      set((state) => {
        if (state.tabs.some((t) => tabKey(t) === key)) return state;
        return storeFor([...state.tabs, pr], state);
      });
    },

    openFunctionTab: (tab) => {
      const ft: FunctionTab = { kind: "function", ...tab };
      const key = tabKey(ft);
      set((state) => {
        if (state.tabs.some((t) => tabKey(t) === key)) return state;
        return storeFor([...state.tabs, ft], state);
      });
    },

    openExtensionTab: (tab) => {
      const et: ExtensionTab = { kind: "extension", ...tab };
      const key = tabKey(et);
      set((state) => {
        if (state.tabs.some((t) => tabKey(t) === key)) return state;
        return storeFor([...state.tabs, et], state);
      });
    },

    openExtensionPanel: (tab) => {
      const et: ExtensionPanelTab = { kind: "extension-panel", ...tab };
      const key = tabKey(et);
      set((state) => {
        const index = state.tabs.findIndex((t) => tabKey(t) === key);
        if (index === -1) return storeFor([...state.tabs, et], state);
        const tabs = [...state.tabs];
        tabs[index] = et;
        return storeFor(tabs, state);
      });
    },

    openPackageTab: (tab) => {
      const pt: PackageTab = { kind: "package", ...tab };
      const key = tabKey(pt);
      set((state) => {
        if (state.tabs.some((t) => tabKey(t) === key)) return state;
        return storeFor([...state.tabs, pt], state);
      });
    },

    updateCompareTab: (id, compare, title) => {
      set((state) =>
        storeFor(
          state.tabs.map((tab) =>
            tab.kind === "tool" && tab.tool === "compare" && tab.id === id
              ? { ...tab, compare, title }
              : tab,
          ),
          state,
        ),
      );
    },

    openToolTab: (tool, id) => {
      const tt: ToolTab = { kind: "tool", tool, ...(id ? { id } : {}) };
      const key = tabKey(tt);
      set((state) => {
        if (state.tabs.some((t) => tabKey(t) === key)) return state;
        const tabs =
          tool === "compare" && id
            ? state.tabs.filter(
                (tab) => !(tab.kind === "tool" && tab.tool === "compare" && !tab.id),
              )
            : state.tabs;
        return storeFor([...tabs, tt], state);
      });
    },

    openRoleTab: (tab) => {
      const rt: RoleTab = { kind: "role", ...tab };
      const key = tabKey(rt);
      set((state) => {
        if (state.tabs.some((t) => tabKey(t) === key)) return state;
        return storeFor([...state.tabs, rt], state);
      });
    },

    openTriggerTab: (tab) => {
      const tt: TriggerTab = { kind: "trigger", ...tab };
      const key = tabKey(tt);
      set((state) => {
        if (state.tabs.some((t) => tabKey(t) === key)) return state;
        return storeFor([...state.tabs, tt], state);
      });
    },

    openViewEditorTab: (tab) => {
      const vt: ViewEditorTab = { kind: "view-editor", ...tab };
      const key = tabKey(vt);
      set((state) => {
        if (state.tabs.some((t) => tabKey(t) === key)) return state;
        return storeFor([...state.tabs, vt], state);
      });
    },

    openAlterTableTab: (tab) => {
      const at: AlterTableTab = { kind: "alter-table", ...tab };
      const key = tabKey(at);
      set((state) => {
        if (state.tabs.some((t) => tabKey(t) === key)) return state;
        return storeFor([...state.tabs, at], state);
      });
    },
  };
}
