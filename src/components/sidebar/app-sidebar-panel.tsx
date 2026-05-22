import { useState } from "react";

import { Link, useMatchRoute } from "@tanstack/react-router";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  DatabaseIcon,
  EyeIcon,
  LayersIcon,
  SettingsIcon,
  TableIcon,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import {
  useActiveDatabase,
  useActiveSchema,
  useDbSelectionStore,
} from "@/lib/db-selection";
import {
  useDatabasesQuery,
  useSchemasQuery,
  useTablesQuery,
  useViewsQuery,
} from "@/lib/queries";
import { useSidebarPanel } from "@/lib/sidebar-panel";

export function AppSidebarPanel() {
  const connections = useConnectionsStore((state) => state.connections);
  const setActiveId = useConnectionsStore((state) => state.setActiveId);
  const activeConnection = useActiveConnection();
  const setWidth = useSidebarPanel((state) => state.setWidth);
  const setIsResizing = useSidebarPanel((state) => state.setIsResizing);
  const matchRoute = useMatchRoute();
  const setDatabase = useDbSelectionStore((state) => state.setDatabase);
  const setSchema = useDbSelectionStore((state) => state.setSchema);
  const activeDatabase = useActiveDatabase();
  const activeSchema = useActiveSchema();
  const { data: databases, isLoading: databasesLoading } = useDatabasesQuery();
  const { data: schemas, isLoading: schemasLoading } = useSchemasQuery();
  const {
    data: tables,
    isLoading: tablesLoading,
    isError: tablesError,
    error: tablesErrorValue,
  } = useTablesQuery();
  const {
    data: views,
    isLoading: viewsLoading,
    isError: viewsError,
    error: viewsErrorValue,
  } = useViewsQuery();

  const [sidebarTab, setSidebarTab] = useState<"tables" | "views">("tables");

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = useSidebarPanel.getState().width;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setWidth(startWidth + (moveEvent.clientX - startX));
    };

    const handlePointerUp = () => {
      setIsResizing(false);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    setIsResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  return (
    <Sidebar collapsible="none" className="relative hidden flex-1 md:flex">
      <SidebarHeader className="gap-3.5 border-b p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <DatabaseIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">
                {activeConnection ? activeConnection.name : "Keine Verbindung"}
              </span>
              <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
          >
            <DropdownMenuLabel>Verbindung wechseln</DropdownMenuLabel>
            {connections.length === 0 ? (
              <DropdownMenuItem disabled>
                Keine Verbindungen gespeichert
              </DropdownMenuItem>
            ) : (
              connections.map((connection) => (
                <DropdownMenuItem
                  key={connection.id}
                  onSelect={() => setActiveId(connection.id)}
                >
                  <DatabaseIcon className="text-muted-foreground" />
                  <span className="flex-1 truncate">{connection.name}</span>
                  {connection.id === activeConnection?.id ? (
                    <CheckIcon className="size-4" />
                  ) : null}
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/connections">
                <SettingsIcon className="text-muted-foreground" />
                Verbindungen verwalten
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {activeConnection ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="grid min-w-0 gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Datenbank
              </span>
              <Select
                value={activeDatabase ?? undefined}
                onValueChange={(value) =>
                  setDatabase(activeConnection.id, value)
                }
                disabled={databasesLoading}
              >
                <SelectTrigger size="sm" className="w-full">
                  <DatabaseIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <SelectValue placeholder="Wählen…" />
                </SelectTrigger>
                <SelectContent>
                  {(databases ?? []).map((database) => (
                    <SelectItem key={database} value={database}>
                      {database}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid min-w-0 gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Schema
              </span>
              <Select
                value={activeSchema}
                onValueChange={(value) => setSchema(activeConnection.id, value)}
                disabled={schemasLoading}
              >
                <SelectTrigger size="sm" className="w-full">
                  <LayersIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <SelectValue placeholder="Wählen…" />
                </SelectTrigger>
                <SelectContent>
                  {(schemas ?? []).map((schema) => (
                    <SelectItem key={schema} value={schema}>
                      {schema}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}
      </SidebarHeader>
      <SidebarContent>
        {activeConnection ? (
          <div className="px-2 pt-2">
            <Tabs
              value={sidebarTab}
              onValueChange={(v) => setSidebarTab(v as "tables" | "views")}
            >
              <TabsList className="w-full">
                <TabsTrigger value="tables" className="flex-1">
                  <TableIcon className="size-3.5" />
                  Tabellen
                </TabsTrigger>
                <TabsTrigger value="views" className="flex-1">
                  <EyeIcon className="size-3.5" />
                  Views
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        ) : null}
        <SidebarGroup>
          <SidebarGroupLabel>
            {sidebarTab === "tables" ? "Tabellen" : "Views"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {!activeConnection ? (
              <p className="px-2 py-1 text-sm text-muted-foreground">
                Keine Verbindung aktiv.
              </p>
            ) : sidebarTab === "tables" ? (
              <SidebarEntityList
                items={tables}
                isLoading={tablesLoading}
                isError={tablesError}
                error={tablesErrorValue}
                emptyMessage="Keine Tabellen gefunden."
                type="table"
                matchRoute={matchRoute}
              />
            ) : (
              <SidebarEntityList
                items={views}
                isLoading={viewsLoading}
                isError={viewsError}
                error={viewsErrorValue}
                emptyMessage="Keine Views gefunden."
                type="view"
                matchRoute={matchRoute}
              />
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={handleResizeStart}
        className="absolute inset-y-0 right-0 z-20 w-1 cursor-col-resize bg-transparent transition-colors hover:bg-sidebar-border"
      />
    </Sidebar>
  );
}

interface SidebarEntityListProps {
  items: { schema: string; name: string }[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  emptyMessage: string;
  type: "table" | "view";
  matchRoute: ReturnType<typeof useMatchRoute>;
}

function SidebarEntityList({
  items,
  isLoading,
  isError,
  error,
  emptyMessage,
  type,
  matchRoute,
}: SidebarEntityListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        {type === "table" ? "Lade Tabellen…" : "Lade Views…"}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="px-2 py-1 text-sm text-destructive">{String(error)}</p>
    );
  }

  if (!items || items.length === 0) {
    return (
      <p className="px-2 py-1 text-sm text-muted-foreground">{emptyMessage}</p>
    );
  }

  return (
    <SidebarMenu>
      {items.map((item) => {
        const isActive = Boolean(
          matchRoute({
            to: "/tables/$schema/$table",
            params: { schema: item.schema, table: item.name },
          }),
        );
        return (
          <SidebarMenuItem key={`${item.schema}.${item.name}`}>
            <SidebarMenuButton asChild isActive={isActive}>
              <Link
                to="/tables/$schema/$table"
                params={{ schema: item.schema, table: item.name }}
                search={{ type }}
              >
                {type === "table" ? (
                  <TableIcon className="text-muted-foreground" />
                ) : (
                  <EyeIcon className="text-muted-foreground" />
                )}
                <span className="truncate">{item.name}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}
