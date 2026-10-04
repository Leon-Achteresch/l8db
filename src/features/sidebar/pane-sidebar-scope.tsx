import { warn as splitDebug } from "@tauri-apps/plugin-log";
import { type ReactNode, useEffect } from "react";
import { PaneSidebarPanel } from "@/features/sidebar/pane-sidebar-panel";
import { ConnectionScopeContext } from "@/lib/connections";
import { useSettingsStore } from "@/lib/settings";
import { useFocusedPaneScope, useSplitView } from "@/lib/split-view";
import { useActiveWorkspaceTab } from "@/lib/use-active-workspace-tab";

export function PaneSidebarScope({ children }: { children: ReactNode }) {
  const easyMode = useSettingsStore((state) => state.easyMode);
  const splitVisible = Boolean(useActiveWorkspaceTab());
  const focused = useFocusedPaneScope();
  const scope = !easyMode && splitVisible ? focused : null;
  const panes = useSplitView((state) => state.panes);
  const focusedPane = useSplitView((state) => state.focusedPane);
  useEffect(() => {
    void splitDebug(
      `[split-debug] sidebar easyMode=${easyMode} splitVisible=${splitVisible} focused=${JSON.stringify(focused)} panes=${JSON.stringify(panes)} focusedPane=${focusedPane} path=${window.location.pathname}${window.location.search}`,
    ).catch(() => undefined);
  }, [easyMode, splitVisible, focused?.connectionId, focused?.index, panes, focusedPane]);
  return (
    <>
      <div className={scope ? "hidden" : "contents"}>{children}</div>
      {scope ? (
        <ConnectionScopeContext.Provider value={scope.connectionId}>
          <PaneSidebarPanel key={scope.connectionId} index={scope.index} />
        </ConnectionScopeContext.Provider>
      ) : null}
    </>
  );
}
