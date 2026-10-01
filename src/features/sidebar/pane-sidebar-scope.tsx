import type { ReactNode } from "react";
import { PaneSidebarPanel } from "@/features/sidebar/pane-sidebar-panel";
import { ConnectionScopeContext } from "@/lib/connections";
import { useSettingsStore } from "@/lib/settings";
import { useFocusedPaneScope } from "@/lib/split-view";
import { useActiveWorkspaceTab } from "@/lib/use-active-workspace-tab";

export function PaneSidebarScope({ children }: { children: ReactNode }) {
  const easyMode = useSettingsStore((state) => state.easyMode);
  const splitVisible = Boolean(useActiveWorkspaceTab());
  const focused = useFocusedPaneScope();
  const scope = !easyMode && splitVisible ? focused : null;
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
