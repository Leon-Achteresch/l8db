import { type ReactNode, useMemo } from "react";
import { PluginBoundary } from "@/features/ui-plugins/plugin-boundary";
import { useConnectionsStore } from "@/lib/connections";
import type { Tab } from "@/lib/table-tabs";
import type { UiPluginRegistry } from "@/lib/ui-plugins/registry";
import { tabInfo } from "@/lib/ui-plugins/tab-info";
import { TabItemDefault, TabItemDefaultContent } from "./tab-item-default";

export function PluginTabItem({
  tab,
  active,
  tabItem,
  children,
}: {
  tab: Tab;
  active: boolean;
  tabItem: NonNullable<UiPluginRegistry["tabItem"]>;
  children: ReactNode;
}) {
  const connection = useConnectionsStore((state) =>
    state.connections.find((entry) => entry.id === (tab.connectionId ?? state.activeId)),
  );
  const output = useMemo(
    () => tabItem({ tab: tabInfo(tab, connection), active, Default: TabItemDefault }),
    [tabItem, tab, connection, active],
  );
  if (!output) return children;
  return (
    <span
      data-ui-plugin={output.plugin}
      className="flex min-w-0 items-center gap-1.5 overflow-hidden"
      style={{ contain: "layout paint" }}
    >
      <PluginBoundary plugin={output.plugin} fallback={children} resetKey={tabItem}>
        <TabItemDefaultContent.Provider value={children}>
          {output.node}
        </TabItemDefaultContent.Provider>
      </PluginBoundary>
    </span>
  );
}
