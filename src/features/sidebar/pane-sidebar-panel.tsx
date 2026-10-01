import { startTransition, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { ProviderLogo } from "@/components/provider-logo";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { PaneNumber } from "@/features/shell/split-pane/pane-number";
import { SidebarObjectTabs } from "@/features/sidebar/sidebar-object-tabs";
import { providerFor } from "@/lib/connection-url";
import { useActiveConnection } from "@/lib/connections";
import { useActiveCapabilities } from "@/lib/db-selection";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { PaneTabTargetContext } from "@/lib/pane-tab-target";
import { useSplitView } from "@/lib/split-view";
import { remoteTab } from "@/lib/table-tabs";

import { SidebarScopeSelects } from "./app-sidebar-panel/sidebar-scope-selects";
import { type SidebarTabValue, sidebarTabLabel } from "./app-sidebar-panel/sidebar-tab";
import { SidebarTabContent } from "./app-sidebar-panel/sidebar-tab-content";
import { useSidebarObjectQueries } from "./app-sidebar-panel/use-sidebar-object-queries";
import { useSidebarScope } from "./app-sidebar-panel/use-sidebar-scope";
import { useSidebarTabs } from "./app-sidebar-panel/use-sidebar-tabs";

const NO_CONNECTIONS: never[] = [];

export function PaneSidebarPanel({ index }: { index: number }) {
  const connection = useActiveConnection();
  const caps = useActiveCapabilities();
  const scope = useSidebarScope(NO_CONNECTIONS, connection);
  const [selectedTab, setSelectedTab] = useState<SidebarTabValue>("tables");
  const q = useSidebarObjectQueries(selectedTab);
  const packages = q.functions?.filter((f) => f.return_type === "PACKAGE");
  const plainFunctions = q.functions?.filter((f) => f.return_type !== "PACKAGE");
  const tabs = useSidebarTabs(Boolean(packages?.length)).filter((tab) => tab.value !== "queries");
  const sidebarTab = tabs.some((tab) => tab.value === selectedTab) ? selectedTab : "tables";
  const current = remoteTab(useSplitView((state) => state.panes[index]));
  const setPaneTab = useSplitView((state) => state.setPaneTab);
  const feature = useNewFeatureVisibility<HTMLDivElement>("split.pane-tables");
  const objectsFeature = useNewFeatureVisibility<HTMLDivElement>("split.pane-objects");

  if (!connection) return null;

  return (
    <Sidebar
      collapsible="none"
      style={{ width: "var(--sidebar-width)" }}
      className="hidden min-h-0 min-w-0 shrink-0 overflow-hidden md:flex"
    >
      <SidebarHeader className="gap-3.5 border-b p-2">
        <div
          ref={feature.ref}
          className="flex h-10 w-full min-w-0 items-center gap-2 rounded-xl border border-border px-3 text-xs shadow-sm"
          style={{ backgroundColor: `${connection.color ?? "#64748b"}1a` }}
        >
          <PaneNumber index={index} />
          <ProviderLogo
            providerId={providerFor(connection).id}
            kind={connection.kind}
            className="size-4"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{connection.name}</span>
            <span className="block truncate text-[10px] text-muted-foreground">
              Auswahl öffnet in Bereich {index + 1}
            </span>
          </span>
          {feature.isNew && <NewBadge />}
        </div>
        <SidebarScopeSelects
          activeConnection={connection}
          caps={caps}
          isSwitching={false}
          scope={scope}
        />
      </SidebarHeader>
      {tabs.length > 1 ? (
        <div
          ref={objectsFeature.ref}
          className="flex shrink-0 items-center gap-1 border-b px-2 py-2"
        >
          <div className="min-w-0 flex-1">
            <SidebarObjectTabs
              tabs={tabs}
              value={sidebarTab}
              onValueChange={(value) =>
                startTransition(() => setSelectedTab(value as SidebarTabValue))
              }
            />
          </div>
          {objectsFeature.isNew && <NewBadge />}
        </div>
      ) : null}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            {caps.object_storage && sidebarTab === "tables"
              ? "Buckets"
              : sidebarTabLabel(sidebarTab)}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <PaneTabTargetContext.Provider
              value={{ current, open: (tab) => setPaneTab(index, connection.id, tab) }}
            >
              <SidebarTabContent
                hasConnection
                objectStorage={caps.object_storage}
                sidebarTab={sidebarTab}
                q={q}
                packages={packages}
                plainFunctions={plainFunctions}
              />
            </PaneTabTargetContext.Provider>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
