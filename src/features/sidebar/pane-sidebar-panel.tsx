import { EyeIcon, TableIcon } from "lucide-react";
import { useState } from "react";
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
import { useTablesQuery, useViewsQuery } from "@/lib/queries";
import { useSplitView } from "@/lib/split-view";
import { remoteTableTab } from "@/lib/table-tabs";

import { SidebarEntityList } from "./app-sidebar-panel/sidebar-entity-list";
import { SidebarScopeSelects } from "./app-sidebar-panel/sidebar-scope-selects";
import { useSidebarScope } from "./app-sidebar-panel/use-sidebar-scope";

const NO_CONNECTIONS: never[] = [];

const OBJECT_TABS = [
  { value: "table", label: "Tabellen", icon: TableIcon },
  { value: "view", label: "Views", icon: EyeIcon },
];

export function PaneSidebarPanel({ index }: { index: number }) {
  const connection = useActiveConnection();
  const caps = useActiveCapabilities();
  const scope = useSidebarScope(NO_CONNECTIONS, connection);
  const [selected, setSelected] = useState<"table" | "view">("table");
  const type = caps.views ? selected : "table";
  const tables = useTablesQuery();
  const views = useViewsQuery(type === "view");
  const query = type === "view" ? views : tables;
  const current = remoteTableTab(useSplitView((state) => state.panes[index]));
  const setPaneTable = useSplitView((state) => state.setPaneTable);
  const feature = useNewFeatureVisibility<HTMLDivElement>("split.pane-tables");

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
      {caps.views ? (
        <div className="shrink-0 border-b px-2 py-2">
          <SidebarObjectTabs
            tabs={OBJECT_TABS}
            value={type}
            onValueChange={(value) => setSelected(value === "view" ? "view" : "table")}
          />
        </div>
      ) : null}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{type === "view" ? "Views" : "Tabellen"}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarEntityList
              items={query.data}
              isLoading={query.isLoading}
              isError={query.isError}
              error={query.error}
              emptyMessage={type === "view" ? "Keine Views gefunden." : "Keine Tabellen gefunden."}
              type={type}
              activeItem={
                current && (current.entityType ?? "table") === type
                  ? `${current.schema}.${current.table}`
                  : null
              }
              onPick={(schema, table) =>
                setPaneTable(index, connection.id, { schema, table, entityType: type })
              }
            />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
