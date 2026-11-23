import { type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { useSettingsStore } from "@/lib/settings";
import { focusedConnectionId, useSplitView } from "@/lib/split-view";
import { tabKey } from "@/lib/table-tabs";
import { useActiveWorkspaceTab } from "@/lib/use-active-workspace-tab";

export function useFocusedConnection(): SavedConnection | null {
  const easyMode = useSettingsStore((state) => state.easyMode);
  const routeTab = useActiveWorkspaceTab();
  const routeKey = routeTab ? tabKey(routeTab) : null;
  const activeId = useConnectionsStore((state) => state.activeId);
  const connections = useConnectionsStore((state) => state.connections);
  const id = useSplitView((state) =>
    easyMode ? activeId : focusedConnectionId(state, routeKey, activeId, connections),
  );
  return connections.find((entry) => entry.id === id) ?? null;
}
