import { useNavigate } from "@tanstack/react-router";
import {
  BracesIcon,
  EyeIcon,
  FileCodeIcon,
  FilterIcon,
  LinkIcon,
  ListOrderedIcon,
  PackageIcon,
  SquareFunctionIcon,
  TableIcon,
  UsersIcon,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";
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
import { SidebarObjectTabs } from "@/features/sidebar/sidebar-object-tabs";
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

const TableSearchModal = lazy(() =>
  import("@/features/sidebar/table-search-modal").then((module) => ({
    default: module.TableSearchModal,
  })),
);

export function AppSidebarPanel() {
  const easyMode = useSettingsStore((state) => state.easyMode);
  const connections = useConnectionsStore((state) => state.connections);
  const activeConnection = useActiveConnection();
  const isSwitching = useConnectionSwitch((state) => state.isSwitching);
  const switchTargetId = useConnectionSwitch((state) => state.targetId);
  const switchTarget = connections.find((connection) => connection.id === switchTargetId);
  const navigate = useNavigate();
  const scope = useSidebarScope(connections, activeConnection);
  const [selectedTab, setSidebarTab] = useState<SidebarTabValue>("tables");
  const q = useSidebarObjectQueries(selectedTab);

  const caps = useActiveCapabilities();
  const packages = q.functions?.filter((f) => f.return_type === "PACKAGE");
  const plainFunctions = q.functions?.filter((f) => f.return_type !== "PACKAGE");
  const sidebarTabs = [
    { value: "tables", label: "Tabellen", icon: TableIcon, enabled: true },
    { value: "views", label: "Views", icon: EyeIcon, enabled: caps.views },
    { value: "functions", label: "Funktionen", icon: BracesIcon, enabled: caps.functions },
    {
      value: "procedures",
      label: "Prozeduren",
      icon: SquareFunctionIcon,
      enabled: caps.procedures,
    },
    {
      value: "packages",
      label: "Packages",
      icon: PackageIcon,
      enabled: Boolean(packages?.length),
    },
    { value: "synonyms", label: "Synonyme", icon: LinkIcon, enabled: caps.synonyms },
    { value: "extensions", label: "Packages", icon: PackageIcon, enabled: caps.extensions },
    { value: "roles", label: "Benutzer", icon: UsersIcon, enabled: caps.roles },
    { value: "queries", label: "Queries", icon: FileCodeIcon, enabled: true },
    {
      value: "sequences",
      label: "Sequenzen",
      icon: ListOrderedIcon,
      enabled: !easyMode && caps.sequences,
    },
  ].filter((tab) => tab.enabled);
  const sidebarTab = sidebarTabs.some((tab) => tab.value === selectedTab) ? selectedTab : "tables";
  const [schemaDialogOpen, setSchemaDialogOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [searchModalMounted, setSearchModalMounted] = useState(false);

  return (
    <Sidebar
      collapsible="none"
      style={{ width: "var(--sidebar-width)" }}
      className="hidden min-h-0 min-w-0 shrink-0 overflow-hidden border-r md:flex"
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
      {activeConnection ? (
        <div className="shrink-0 border-b px-2 py-2" data-tour="sidebar-tabs">
          <SidebarObjectTabs
            tabs={sidebarTabs}
            value={sidebarTab}
            onValueChange={(value) => setSidebarTab(value as typeof sidebarTab)}
          />
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
            <SidebarGroupLabel className="flex-1">{sidebarTabLabel(sidebarTab)}</SidebarGroupLabel>
            {sidebarTab === "functions" ||
            sidebarTab === "procedures" ||
            sidebarTab === "packages" ||
            sidebarTab === "views" ? (
              <CompileInvalidButton types={INVALID_GROUP_TYPES[sidebarTab] ?? []} />
            ) : null}
          </div>
          {caps.query_language !== "redis" &&
          (sidebarTab === "tables" || sidebarTab === "views") ? (
            <SidebarGroupAction
              onClick={() => {
                setSearchModalMounted(true);
                setSearchModalOpen(true);
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
        {activeConnection ? <SidebarFooterActions caps={caps} /> : null}
      </SidebarContent>
      <SchemaManagerDialog open={schemaDialogOpen} onOpenChange={setSchemaDialogOpen} />
    </Sidebar>
  );
}
