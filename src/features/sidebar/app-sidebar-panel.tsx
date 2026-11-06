import { useNavigate } from "@tanstack/react-router";
import { FilterIcon } from "lucide-react";
import { lazy, Suspense, startTransition, useState } from "react";
import { useShallow } from "zustand/shallow";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { ExtensionSidebarViews } from "@/features/extensions/extension-sidebar-views";
import { CompileInvalidButton } from "@/features/sidebar/compile-invalid-button";
import { SidebarFavorites } from "@/features/sidebar/sidebar-favorites";
import { SidebarObjectSelect } from "@/features/sidebar/sidebar-object-select";
import { SidebarObjectTabs } from "@/features/sidebar/sidebar-object-tabs";
import { siblingConnections } from "@/lib/connection-groups";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { useActiveCapabilities } from "@/lib/db-selection";
import { INVALID_GROUP_TYPES } from "@/lib/invalid-objects";
import { useSettingsStore } from "@/lib/settings";
import { activateConnectionWithToast, useConnectionSwitch } from "@/lib/ssh";

import { SchemaManagerDialog } from "./app-sidebar-panel/schema-manager-dialog";

import { SidebarConnectionPicker } from "./app-sidebar-panel/sidebar-connection-picker";
import { SidebarFooterActions } from "./app-sidebar-panel/sidebar-footer-actions";
import { SidebarScopeSelects } from "./app-sidebar-panel/sidebar-scope-selects";
import { type SidebarTabValue, sidebarTabLabel } from "./app-sidebar-panel/sidebar-tab";
import { SidebarTabContent } from "./app-sidebar-panel/sidebar-tab-content";
import { useSidebarObjectQueries } from "./app-sidebar-panel/use-sidebar-object-queries";
import { useSidebarScope } from "./app-sidebar-panel/use-sidebar-scope";
import { useSidebarTabs } from "./app-sidebar-panel/use-sidebar-tabs";

const TableSearchModal = lazy(() =>
  import("@/features/sidebar/table-search-modal").then((module) => ({
    default: module.TableSearchModal,
  })),
);

export function AppSidebarPanel() {
  const activeConnection = useActiveConnection();
  const isSwitching = useConnectionSwitch((state) => state.isSwitching);
  const switchTargetId = useConnectionSwitch((state) => state.targetId);
  const switchTarget = useConnectionsStore((state) =>
    state.connections.find((connection) => connection.id === switchTargetId),
  );
  const siblings = useConnectionsStore(
    useShallow((state) => siblingConnections(state.connections, activeConnection)),
  );
  const navigate = useNavigate();
  const scope = useSidebarScope(siblings, activeConnection);
  const [selectedTab, setSidebarTab] = useState<SidebarTabValue>("tables");
  const q = useSidebarObjectQueries(selectedTab);

  const caps = useActiveCapabilities();
  const packages = q.functions?.filter((f) => f.return_type === "PACKAGE");
  const plainFunctions = q.functions?.filter((f) => f.return_type !== "PACKAGE");
  const sidebarTabs = useSidebarTabs(Boolean(packages?.length));
  const sidebarTab = sidebarTabs.some((tab) => tab.value === selectedTab) ? selectedTab : "tables";
  const [schemaDialogOpen, setSchemaDialogOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [searchModalMounted, setSearchModalMounted] = useState(false);
  const objectNav = useSettingsStore((state) => state.sidebarObjectNav);
  const changeTab = (value: string) =>
    startTransition(() => setSidebarTab(value as typeof sidebarTab));

  return (
    <Sidebar
      collapsible="none"
      style={{ width: "var(--sidebar-width)" }}
      className="hidden min-h-0 min-w-0 shrink-0 overflow-hidden md:flex"
    >
      <SidebarHeader className="gap-3.5 border-b p-2">
        <SidebarConnectionPicker
          activeConnection={activeConnection}
          busyId={isSwitching ? switchTargetId : null}
          isSwitching={isSwitching}
          switchTarget={switchTarget}
          onSelect={(id) => {
            if (useConnectionSwitch.getState().isSwitching) return;
            if (id === activeConnection?.id) return;
            void activateConnectionWithToast(id).then((ok) => {
              if (ok) void navigate({ to: "/" });
            });
          }}
        />
        {activeConnection ? (
          <SidebarScopeSelects
            activeConnection={activeConnection}
            caps={caps}
            isSwitching={isSwitching}
            scope={scope}
            onManageSchemas={() => setSchemaDialogOpen(true)}
          />
        ) : null}
      </SidebarHeader>
      {activeConnection && objectNav === "tabs" ? (
        <div className="shrink-0 border-b px-2 py-2" data-tour="sidebar-tabs">
          <SidebarObjectTabs tabs={sidebarTabs} value={sidebarTab} onValueChange={changeTab} />
        </div>
      ) : null}
      <SidebarContent>
        <SidebarFavorites />
        <SidebarGroup>
          <div
            className={
              sidebarTab === "views" ? "flex items-center gap-1 pr-7" : "flex items-center gap-1"
            }
          >
            {activeConnection && objectNav === "select" ? (
              <div className="flex min-w-0 flex-1" data-tour="sidebar-tabs">
                <SidebarObjectSelect
                  tabs={sidebarTabs}
                  value={sidebarTab}
                  onValueChange={changeTab}
                />
              </div>
            ) : (
              <SidebarGroupLabel className="flex-1">
                {caps.object_storage && sidebarTab === "tables"
                  ? "Buckets"
                  : sidebarTabLabel(sidebarTab)}
              </SidebarGroupLabel>
            )}
            {sidebarTab === "functions" ||
            sidebarTab === "procedures" ||
            sidebarTab === "packages" ||
            sidebarTab === "views" ? (
              <CompileInvalidButton types={INVALID_GROUP_TYPES[sidebarTab] ?? []} />
            ) : null}
          </div>
          {caps.query_language !== "redis" &&
          !caps.object_storage &&
          (sidebarTab === "tables" || sidebarTab === "views") ? (
            <SidebarGroupAction
              onClick={() => {
                startTransition(() => {
                  setSearchModalMounted(true);
                  setSearchModalOpen(true);
                });
              }}
              aria-label="Erweiterte Suche"
              title="Erweiterte Suche mit Regex & SQL WHERE"
            >
              <FilterIcon />
            </SidebarGroupAction>
          ) : null}
          <SidebarGroupContent>
            <SidebarTabContent
              hasConnection={Boolean(activeConnection)}
              objectStorage={caps.object_storage}
              sidebarTab={sidebarTab}
              q={q}
              packages={packages}
              plainFunctions={plainFunctions}
            />
          </SidebarGroupContent>
        </SidebarGroup>
        <ExtensionSidebarViews />
        {searchModalMounted && (
          <Suspense fallback={null}>
            <TableSearchModal open={searchModalOpen} onOpenChange={setSearchModalOpen} />
          </Suspense>
        )}
      </SidebarContent>
      {activeConnection ? <SidebarFooterActions caps={caps} /> : null}
      <SchemaManagerDialog open={schemaDialogOpen} onOpenChange={setSchemaDialogOpen} />
    </Sidebar>
  );
}
