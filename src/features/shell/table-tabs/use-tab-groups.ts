import { useMemo } from "react";
import { useConnectionsStore } from "@/lib/connections";
import type { Tab } from "@/lib/table-tabs";
import type { TabGroup } from "@/lib/ui-plugins/api";
import { useUiPluginRegistry } from "@/lib/ui-plugins/store";
import { tabInfo } from "@/lib/ui-plugins/tab-info";

export function useTabGroups(tabs: Tab[]): (TabGroup | undefined)[] | null {
  const tabGroup = useUiPluginRegistry((registry) => registry.tabGroup);
  const connections = useConnectionsStore((state) => (tabGroup ? state.connections : null));
  const activeId = useConnectionsStore((state) => (tabGroup ? state.activeId : null));
  return useMemo(() => {
    if (!tabGroup || !connections) return null;
    return tabs.map((tab) =>
      tabGroup(
        tabInfo(
          tab,
          connections.find((entry) => entry.id === (tab.connectionId ?? activeId)),
        ),
      ),
    );
  }, [tabGroup, tabs, connections, activeId]);
}
