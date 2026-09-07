import { useQueryClient } from "@tanstack/react-query";
import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import {
  ActivityIcon,
  BracesIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  ColumnsIcon,
  DatabaseIcon,
  EyeIcon,
  FileCodeIcon,
  FilterIcon,
  KeyRoundIcon,
  LayersIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  NetworkIcon,
  PackageIcon,
  PlusIcon,
  RadioIcon,
  SearchIcon,
  SettingsIcon,
  SquareFunctionIcon,
  SquareTerminalIcon,
  StarIcon,
  StarOffIcon,
  TableIcon,
  TrashIcon,
  UploadIcon,
  UsersIcon,
  WrenchIcon,
} from "lucide-react";
import { lazy, Suspense, useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";

import { DatabaseLogo, SchemaLogo } from "@/components/named-logo";
import { ProviderLogo } from "@/components/provider-logo";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCompileObject } from "@/features/functions/use-compile-object";
import { SidebarFavorites } from "@/features/sidebar/sidebar-favorites";
import { SidebarPackageList } from "@/features/sidebar/sidebar-package-list";
import { SidebarProcedureList } from "@/features/sidebar/sidebar-procedure-list";
import { SidebarSynonymList } from "@/features/sidebar/sidebar-synonym-list";

import { connectionUser, groupByServer, siblingConnections } from "@/lib/connection-groups";
import { providerFor } from "@/lib/connection-url";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import {
  createMaterializedView,
  createSchema,
  dropSchema,
  dropTable,
  truncateTable,
} from "@/lib/db";
import {
  useActiveCapabilities,
  useActiveDatabase,
  useActiveSchema,
  useDbSelectionStore,
} from "@/lib/db-selection";
import { favoriteId, useObjectFavoritesStore } from "@/lib/object-favorites";
import { packageOid } from "@/lib/plsql";
import {
  useColumnsQuery,
  useDatabasesQuery,
  useExtensionsQuery,
  useFunctionsQuery,
  useMaterializedViewsQuery,
  useProceduresQuery,
  useRolesQuery,
  useSchemasQuery,
  useSequencesQuery,
  useSynonymsQuery,
  useTablesQuery,
  useViewsQuery,
} from "@/lib/queries";
import { useSavedQueriesStore } from "@/lib/saved-queries";
import {
  activateConnectionWithToast,
  effectiveConnectionString,
  useConnectionSwitch,
} from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";

const TableSearchModal = lazy(() =>
  import("@/features/sidebar/table-search-modal").then((module) => ({
    default: module.TableSearchModal,
  })),
);

export function AppSidebarPanel() {
  const connections = useConnectionsStore((state) => state.connections);
  const activeConnection = useActiveConnection();
  const isSwitching = useConnectionSwitch((state) => state.isSwitching);
  const switchTargetId = useConnectionSwitch((state) => state.targetId);
  const switchTarget = connections.find((connection) => connection.id === switchTargetId);
  const matchRoute = useMatchRoute();
  const navigate = useNavigate();
  const setDatabase = useDbSelectionStore((state) => state.setDatabase);
  const setSchema = useDbSelectionStore((state) => state.setSchema);
  const activeDatabase = useActiveDatabase();
  const activeSchema = useActiveSchema();
  const { data: databases, isLoading: databasesLoading } = useDatabasesQuery();
  const { data: schemas, isLoading: schemasLoading } = useSchemasQuery();
  const serverGroups = useMemo(() => groupByServer(connections), [connections]);
  const grouped = serverGroups.some((group) => group.connections.length > 1);
  const siblings = useMemo(
    () => siblingConnections(connections, activeConnection),
    [connections, activeConnection],
  );
  const activeUser = activeConnection ? connectionUser(activeConnection) : "";
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
  const {
    data: functions,
    isLoading: functionsLoading,
    isError: functionsError,
    error: functionsErrorValue,
  } = useFunctionsQuery();
  const {
    data: procedures,
    isLoading: proceduresLoading,
    isError: proceduresError,
    error: proceduresErrorValue,
  } = useProceduresQuery();
  const {
    data: synonyms,
    isLoading: synonymsLoading,
    isError: synonymsError,
    error: synonymsErrorValue,
  } = useSynonymsQuery();
  const {
    data: extensions,
    isLoading: extensionsLoading,
    isError: extensionsError,
    error: extensionsErrorValue,
  } = useExtensionsQuery();
  const {
    data: roles,
    isLoading: rolesLoading,
    isError: rolesError,
    error: rolesErrorValue,
  } = useRolesQuery();

  const {
    data: sequences,
    isLoading: sequencesLoading,
    isError: sequencesError,
    error: sequencesErrorValue,
  } = useSequencesQuery();

  const { data: matviews } = useMaterializedViewsQuery();

  const [selectedTab, setSidebarTab] = useState<
    | "tables"
    | "views"
    | "queries"
    | "functions"
    | "procedures"
    | "packages"
    | "synonyms"
    | "extensions"
    | "roles"
    | "sequences"
  >("tables");
  const caps = useActiveCapabilities();
  const packages = functions?.filter((f) => f.return_type === "PACKAGE");
  const plainFunctions = functions?.filter((f) => f.return_type !== "PACKAGE");
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
    { value: "sequences", label: "Sequenzen", icon: ListOrderedIcon, enabled: caps.sequences },
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-tour="sidebar-connection"
              className="flex w-full items-center gap-2 rounded-2xl border bg-background px-3 py-2 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              {isSwitching ? (
                <Spinner className="size-4 shrink-0" />
              ) : activeConnection ? (
                <ProviderLogo
                  providerId={providerFor(activeConnection).id}
                  kind={activeConnection.kind}
                  className="size-4"
                />
              ) : (
                <DatabaseIcon className="size-4 shrink-0 text-primary" />
              )}
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="truncate">
                  {isSwitching
                    ? switchTarget
                      ? `Verbinde… ${switchTarget.name}`
                      : "Verbinde…"
                    : activeConnection
                      ? activeConnection.name
                      : "Keine Verbindung"}
                </span>
                {isSwitching
                  ? null
                  : activeConnection?.tags?.map((tag, index) => (
                      <span
                        key={index}
                        className="inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-[9px] font-medium text-white"
                        style={{ backgroundColor: tag.color }}
                      >
                        {tag.name}
                      </span>
                    ))}
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
              <DropdownMenuItem disabled>Keine Verbindungen gespeichert</DropdownMenuItem>
            ) : (
              serverGroups.map((group) => (
                <DropdownMenuGroup key={group.key}>
                  {grouped && (
                    <DropdownMenuLabel className="flex items-center gap-1.5 pt-2 font-mono text-[10px] font-normal text-muted-foreground">
                      <ProviderLogo
                        providerId={providerFor(group.connections[0]).id}
                        kind={group.kind}
                        className="size-3"
                      />
                      <span className="truncate">{group.label}</span>
                      <span className="ml-auto shrink-0 tabular-nums">
                        {group.connections.length}
                      </span>
                    </DropdownMenuLabel>
                  )}
                  {group.connections.map((connection) => (
                    <DropdownMenuItem
                      key={connection.id}
                      disabled={isSwitching}
                      onSelect={() => {
                        if (useConnectionSwitch.getState().isSwitching) return;
                        if (connection.id === activeConnection?.id) return;
                        void activateConnectionWithToast(connection.id).then((ok) => {
                          if (ok) void navigate({ to: "/" });
                        });
                      }}
                    >
                      {grouped ? (
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: connection.color ?? "var(--border)" }}
                        />
                      ) : (
                        <ProviderLogo
                          providerId={providerFor(connection).id}
                          kind={connection.kind}
                        />
                      )}
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="truncate">{connection.name}</span>
                        {grouped && connectionUser(connection) && (
                          <span className="truncate font-mono text-[10px] text-muted-foreground">
                            {connectionUser(connection)}
                          </span>
                        )}
                        {connection.tags?.map((tag, index) => (
                          <span
                            key={index}
                            className="inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-[9px] font-medium text-white"
                            style={{ backgroundColor: tag.color }}
                          >
                            {tag.name}
                          </span>
                        ))}
                      </span>
                      {isSwitching && switchTargetId === connection.id ? (
                        <Spinner className="size-4" />
                      ) : connection.id === activeConnection?.id ? (
                        <CheckIcon className="size-4" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
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
          <div className="flex gap-2" data-tour="sidebar-scope">
            {caps.databases && (
              <div className="grid min-w-0 flex-1 gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Datenbank</span>
                <Select
                  value={activeDatabase ?? undefined}
                  onValueChange={(value) => setDatabase(activeConnection.id, value)}
                  disabled={databasesLoading}
                >
                  <SelectTrigger size="sm" className="w-full">
                    {activeDatabase && databases?.includes(activeDatabase) ? null : (
                      <DatabaseIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <SelectValue placeholder="Wählen…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(databases ?? []).map((database) => (
                      <SelectItem key={database} value={database}>
                        <span className="flex min-w-0 items-center gap-2">
                          <DatabaseLogo name={database} kind={activeConnection.kind} />
                          <span className="truncate">{database}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {caps.schemas && (
              <div className="grid min-w-0 flex-1 gap-1.5">
                <span className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                  Schema
                  <button
                    type="button"
                    onClick={() => setSchemaDialogOpen(true)}
                    className="rounded p-0.5 hover:bg-muted hover:text-foreground"
                    title="Schemas verwalten"
                  >
                    <WrenchIcon className="size-3" />
                  </button>
                </span>
                <Select
                  value={activeSchema}
                  onValueChange={(value) => {
                    if (value.startsWith("conn:")) {
                      if (useConnectionSwitch.getState().isSwitching) return;
                      void activateConnectionWithToast(value.slice(5)).then((ok) => {
                        if (ok) void navigate({ to: "/" });
                      });
                      return;
                    }
                    setSchema(activeConnection.id, value);
                  }}
                  disabled={schemasLoading || isSwitching}
                >
                  <SelectTrigger size="sm" className="w-full">
                    {schemas?.includes(activeSchema) ? null : (
                      <LayersIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <SelectValue placeholder="Wählen…" />
                  </SelectTrigger>
                  <SelectContent>
                    {siblings.length > 0 && (
                      <SelectGroup>
                        <SelectLabel className="flex items-center gap-1.5 text-[10px]">
                          <KeyRoundIcon className="size-3" />
                          Mit eigenem Login
                        </SelectLabel>
                        {siblings.map((connection) => (
                          <SelectItem key={connection.id} value={`conn:${connection.id}`}>
                            <span className="flex min-w-0 items-center gap-2">
                              <SchemaLogo name={connectionUser(connection) || connection.name} />
                              <span className="truncate">
                                {connectionUser(connection) || connection.name}
                              </span>
                              {connectionUser(connection) && (
                                <span className="truncate text-[10px] text-muted-foreground">
                                  {connection.name}
                                </span>
                              )}
                            </span>
                          </SelectItem>
                        ))}
                        <SelectSeparator />
                      </SelectGroup>
                    )}
                    {(schemas ?? []).map((schema) => (
                      <SelectItem key={schema} value={schema}>
                        <span className="flex min-w-0 items-center gap-2">
                          <SchemaLogo name={schema} />
                          <span className="truncate">{schema}</span>
                          {schema.toLowerCase() === activeUser.toLowerCase() && (
                            <KeyRoundIcon className="size-3 shrink-0 text-muted-foreground" />
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        ) : null}
      </SidebarHeader>
      <SidebarContent>
        {activeConnection ? (
          <div className="px-2 pt-2" data-tour="sidebar-tabs">
            <Tabs value={sidebarTab} onValueChange={(v) => setSidebarTab(v as typeof sidebarTab)}>
              <TabsList className="w-full">
                {sidebarTabs.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="flex-1 px-0"
                    aria-label={tab.label}
                  >
                    <tab.icon className="size-4" />
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        ) : null}
        <SidebarFavorites />
        <SidebarGroup>
          <SidebarGroupLabel>
            {sidebarTab === "tables"
              ? "Tabellen"
              : sidebarTab === "views"
                ? "Views"
                : sidebarTab === "functions"
                  ? "Funktionen"
                  : sidebarTab === "procedures"
                    ? "Prozeduren"
                    : sidebarTab === "packages"
                      ? "Packages"
                      : sidebarTab === "synonyms"
                        ? "Synonyme"
                        : sidebarTab === "extensions"
                          ? "Packages"
                          : sidebarTab === "roles"
                            ? "Benutzer & Rollen"
                            : sidebarTab === "sequences"
                              ? "Sequenzen"
                              : "Gespeicherte Queries"}
          </SidebarGroupLabel>
          {sidebarTab === "tables" || sidebarTab === "views" ? (
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
            {!activeConnection ? (
              <p className="py-1 text-sm text-muted-foreground">Keine Verbindung aktiv.</p>
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
            ) : sidebarTab === "views" ? (
              <>
                <SidebarEntityList
                  items={views}
                  isLoading={viewsLoading}
                  isError={viewsError}
                  error={viewsErrorValue}
                  emptyMessage="Keine Views gefunden."
                  type="view"
                  matchRoute={matchRoute}
                />
                <SidebarMatviewList items={matviews} />
              </>
            ) : sidebarTab === "functions" ? (
              <SidebarFunctionList
                items={plainFunctions}
                isLoading={functionsLoading}
                isError={functionsError}
                error={functionsErrorValue}
              />
            ) : sidebarTab === "procedures" ? (
              <SidebarProcedureList
                items={procedures}
                isLoading={proceduresLoading}
                isError={proceduresError}
                error={proceduresErrorValue}
              />
            ) : sidebarTab === "packages" ? (
              <SidebarPackageList
                items={packages}
                isLoading={functionsLoading}
                isError={functionsError}
                error={functionsErrorValue}
              />
            ) : sidebarTab === "synonyms" ? (
              <SidebarSynonymList
                items={synonyms}
                isLoading={synonymsLoading}
                isError={synonymsError}
                error={synonymsErrorValue}
              />
            ) : sidebarTab === "extensions" ? (
              <SidebarExtensionList
                items={extensions}
                isLoading={extensionsLoading}
                isError={extensionsError}
                error={extensionsErrorValue}
              />
            ) : sidebarTab === "roles" ? (
              <SidebarRoleList
                items={roles}
                isLoading={rolesLoading}
                isError={rolesError}
                error={rolesErrorValue}
              />
            ) : sidebarTab === "sequences" ? (
              <SidebarSequenceList
                items={sequences}
                isLoading={sequencesLoading}
                isError={sequencesError}
                error={sequencesErrorValue}
              />
            ) : (
              <SavedQueriesList />
            )}
          </SidebarGroupContent>
        </SidebarGroup>
        {searchModalMounted && (
          <Suspense fallback={null}>
            <TableSearchModal open={searchModalOpen} onOpenChange={setSearchModalOpen} />
          </Suspense>
        )}
        {activeConnection ? (
          <SidebarGroup className="mt-auto border-t pt-2">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link to="/import">
                      <UploadIcon className="text-muted-foreground" />
                      <span>SQL importieren</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link to="/create-table">
                      <PlusIcon className="text-muted-foreground" />
                      <span>Tabelle erstellen</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link to="/sessions">
                      <ActivityIcon className="text-muted-foreground" />
                      <span>Sitzungen & Locks</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link to="/replication">
                      <RadioIcon className="text-muted-foreground" />
                      <span>Replikation</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link to="/enums">
                      <ListIcon className="text-muted-foreground" />
                      <span>Enum-Typen</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SchemaManagerDialog open={schemaDialogOpen} onOpenChange={setSchemaDialogOpen} />
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
  const [search, setSearch] = useState("");
  const [confirmAction, setConfirmAction] = useState<{
    kind: "drop" | "truncate";
    schema: string;
    name: string;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const navigate = useNavigate();
  const openViewEditorTab = useTableTabs((state) => state.openViewEditorTab);
  const openAlterTableTab = useTableTabs((state) => state.openAlterTableTab);
  const openQueryTabWithSql = useTableTabs((state) => state.openQueryTabWithSql);
  const activeConnection = useActiveConnection();
  const activeDatabase = useActiveDatabase();
  const queryClient = useQueryClient();
  const favorites = useObjectFavoritesStore((state) => state.favorites);
  const toggleObjectFavorite = useObjectFavoritesStore((state) => state.toggle);
  const { data: columns } = useColumnsQuery(type === "table" ? "BASE TABLE" : "VIEW");

  const columnsByTable = useMemo(() => {
    if (!columns) return new Map<string, string[]>();
    const map = new Map<string, string[]>();
    for (const col of columns) {
      const key = `${col.schema}.${col.table}`;
      const arr = map.get(key);
      if (arr) {
        arr.push(col.name);
      } else {
        map.set(key, [col.name]);
      }
    }
    return map;
  }, [columns]);

  const deferredSearch = useDeferredValue(search);
  const filtered = useMemo(() => {
    if (!items) return undefined;
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return items.map((item) => ({ ...item, matchingColumns: [] as string[] }));
    return items
      .map((item) => {
        const nameMatch = item.name.toLowerCase().includes(q);
        const key = `${item.schema}.${item.name}`;
        const cols = columnsByTable.get(key) ?? [];
        const matchingColumns = cols.filter((c) => c.toLowerCase().includes(q));
        if (nameMatch || matchingColumns.length > 0) {
          return { ...item, matchingColumns };
        }
        return null;
      })
      .filter(
        (item): item is { schema: string; name: string; matchingColumns: string[] } =>
          item !== null,
      );
  }, [items, deferredSearch, columnsByTable]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        {type === "table" ? "Lade Tabellen…" : "Lade Views…"}
      </div>
    );
  }

  if (isError) {
    return <p className="py-1 text-sm text-destructive">{String(error)}</p>;
  }

  if (!items || items.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  const handleConfirmAction = async () => {
    if (!confirmAction || !activeConnection) return;
    setActionLoading(true);
    try {
      const connStr = effectiveConnectionString(activeConnection);
      const kind = activeConnection.kind;
      if (confirmAction.kind === "drop") {
        await dropTable(
          kind,
          connStr,
          confirmAction.schema,
          confirmAction.name,
          activeDatabase ?? undefined,
        );
      } else {
        await truncateTable(
          kind,
          connStr,
          confirmAction.schema,
          confirmAction.name,
          activeDatabase ?? undefined,
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["tables"] });
      await queryClient.invalidateQueries({ queryKey: ["columns"] });
      await queryClient.invalidateQueries({ queryKey: ["table-rows"] });
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  };

  const handleOpenInEditor = (itemSchema: string, itemName: string) => {
    const id = openQueryTabWithSql(`SELECT * FROM ${itemSchema}."${itemName}";`);
    navigate({ to: "/query/$id", params: { id } });
  };

  const toggleFavoriteObject = (itemSchema: string, itemName: string) => {
    if (!activeConnection) return;
    toggleObjectFavorite({
      connectionId: activeConnection.id,
      database: activeDatabase ?? null,
      schema: itemSchema,
      name: itemName,
      type: type === "view" ? "view" : "table",
    });
  };

  const isFavorite = (itemSchema: string, itemName: string) =>
    activeConnection
      ? favorites.some(
          (favorite) =>
            favoriteId(favorite) ===
            favoriteId({
              connectionId: activeConnection.id,
              database: activeDatabase ?? null,
              schema: itemSchema,
              name: itemName,
              type: type === "view" ? "view" : "table",
            }),
        )
      : false;

  const handleFocusInErDiagram = (itemSchema: string, itemName: string) => {
    navigate({
      to: "/er-diagram",
      search: { focusSchema: itemSchema, focusTable: itemName, depth: 1 },
    });
  };

  const handleAlterTable = (itemSchema: string, itemName: string) => {
    openAlterTableTab({ schema: itemSchema, table: itemName });
    navigate({
      to: "/alter-table/$schema/$table",
      params: { schema: itemSchema, table: itemName },
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative" data-tour="sidebar-search">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <SidebarInput
          placeholder={type === "table" ? "Tabellen & Spalten…" : "Views & Spalten…"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>
      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.kind === "drop"
                ? `Tabelle "${confirmAction.name}" löschen?`
                : `Alle Daten in "${confirmAction?.name}" löschen?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.kind === "drop"
                ? "Die Tabelle und alle enthaltenen Daten werden unwiderruflich gelöscht (DROP TABLE CASCADE)."
                : "Alle Zeilen in dieser Tabelle werden unwiderruflich gelöscht (TRUNCATE TABLE). Die Tabellenstruktur bleibt erhalten."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmAction} disabled={actionLoading}>
              {actionLoading ? <Spinner className="size-4" /> : null}
              {confirmAction?.kind === "drop" ? "Drop Table" : "Delete All"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {filtered && filtered.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">Keine Treffer.</p>
      ) : (
        <SidebarMenu>
          {filtered?.map((item, index) => {
            const isActive =
              type === "view"
                ? Boolean(
                    matchRoute({
                      to: "/view-editor/$schema/$view",
                      params: { schema: item.schema, view: item.name },
                    }),
                  )
                : Boolean(
                    matchRoute({
                      to: "/tables/$schema/$table",
                      params: { schema: item.schema, table: item.name },
                    }),
                  );

            const menuButton =
              type === "view" ? (
                <SidebarMenuButton
                  isActive={isActive}
                  onClick={() => {
                    openViewEditorTab({
                      schema: item.schema,
                      view: item.name,
                    });
                    navigate({
                      to: "/view-editor/$schema/$view",
                      params: { schema: item.schema, view: item.name },
                    });
                  }}
                >
                  <EyeIcon className="text-muted-foreground" />
                  <span className="truncate">{item.name}</span>
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton asChild isActive={isActive}>
                  <Link
                    to="/tables/$schema/$table"
                    params={{ schema: item.schema, table: item.name }}
                    search={{ type }}
                    data-tour={index === 0 && type === "table" ? "sidebar-table" : undefined}
                    data-schema={item.schema}
                    data-name={item.name}
                  >
                    <TableIcon className="text-muted-foreground" />
                    <span className="truncate">{item.name}</span>
                  </Link>
                </SidebarMenuButton>
              );

            return (
              <SidebarMenuItem key={`${item.schema}.${item.name}`}>
                {type === "table" ? (
                  <ContextMenu>
                    <ContextMenuTrigger asChild>{menuButton}</ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        onSelect={() => toggleFavoriteObject(item.schema, item.name)}
                      >
                        {isFavorite(item.schema, item.name) ? <StarOffIcon /> : <StarIcon />}
                        {isFavorite(item.schema, item.name) ? "Favorit lösen" : "Anheften"}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem onSelect={() => handleOpenInEditor(item.schema, item.name)}>
                        <SquareTerminalIcon />
                        Im Editor öffnen
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => handleAlterTable(item.schema, item.name)}>
                        <WrenchIcon />
                        Alter Table
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() => handleFocusInErDiagram(item.schema, item.name)}
                      >
                        <NetworkIcon />
                        Im ER-Diagramm fokussieren
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        onSelect={() =>
                          setConfirmAction({
                            kind: "truncate",
                            schema: item.schema,
                            name: item.name,
                          })
                        }
                      >
                        <TrashIcon />
                        Delete All Rows
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        onSelect={() =>
                          setConfirmAction({ kind: "drop", schema: item.schema, name: item.name })
                        }
                      >
                        <TrashIcon />
                        Drop Table
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ) : (
                  <ContextMenu>
                    <ContextMenuTrigger asChild>{menuButton}</ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        onSelect={() => toggleFavoriteObject(item.schema, item.name)}
                      >
                        {isFavorite(item.schema, item.name) ? <StarOffIcon /> : <StarIcon />}
                        {isFavorite(item.schema, item.name) ? "Favorit lösen" : "Anheften"}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                )}
                {item.matchingColumns.length > 0 && (
                  <SidebarMenuSub>
                    {item.matchingColumns.map((col) => (
                      <SidebarMenuSubItem key={col}>
                        {type === "view" ? (
                          <SidebarMenuSubButton
                            size="sm"
                            onClick={() => {
                              openViewEditorTab({
                                schema: item.schema,
                                view: item.name,
                              });
                              navigate({
                                to: "/view-editor/$schema/$view",
                                params: {
                                  schema: item.schema,
                                  view: item.name,
                                },
                              });
                            }}
                          >
                            <ColumnsIcon className="text-muted-foreground" />
                            <span className="truncate">{col}</span>
                          </SidebarMenuSubButton>
                        ) : (
                          <SidebarMenuSubButton size="sm" asChild>
                            <Link
                              to="/tables/$schema/$table"
                              params={{
                                schema: item.schema,
                                table: item.name,
                              }}
                              search={{ type }}
                            >
                              <ColumnsIcon className="text-muted-foreground" />
                              <span className="truncate">{col}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        )}
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      )}
    </div>
  );
}

interface SidebarFunctionListProps {
  items:
    | { schema: string; name: string; identity_args: string; oid: string; return_type: string }[]
    | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

function SidebarFunctionList({ items, isLoading, isError, error }: SidebarFunctionListProps) {
  const navigate = useNavigate();
  const openFunctionTab = useTableTabs((state) => state.openFunctionTab);
  const openPackageTab = useTableTabs((state) => state.openPackageTab);
  const caps = useActiveCapabilities();
  const { compile } = useCompileObject();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        Lade Funktionen…
      </div>
    );
  }

  if (isError) {
    return <p className="py-1 text-sm text-destructive">{String(error)}</p>;
  }

  if (!items || items.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">Keine Funktionen gefunden.</p>;
  }

  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.oid}>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <SidebarMenuButton
                onClick={() => {
                  if (item.return_type === "PACKAGE") {
                    openPackageTab({ schema: item.schema, name: item.name });
                    navigate({
                      to: "/packages/$schema/$name",
                      params: { schema: item.schema, name: item.name },
                    });
                    return;
                  }
                  openFunctionTab({
                    schema: item.schema,
                    name: item.name,
                    oid: item.oid,
                  });
                  navigate({
                    to: "/functions/$schema/$name",
                    params: { schema: item.schema, name: item.name },
                    search: { oid: item.oid },
                  });
                }}
              >
                {item.return_type === "PACKAGE" ? (
                  <PackageIcon className="text-muted-foreground" />
                ) : (
                  <BracesIcon className="text-muted-foreground" />
                )}
                <span className="truncate">
                  {item.name}
                  {item.return_type === "PACKAGE"
                    ? ""
                    : item.identity_args
                      ? `(${item.identity_args})`
                      : "()"}
                </span>
              </SidebarMenuButton>
            </ContextMenuTrigger>
            <ContextMenuContent>
              {caps.compile_objects ? (
                item.return_type === "PACKAGE" ? (
                  <>
                    <ContextMenuItem
                      onSelect={() => {
                        void compile(
                          packageOid(item.schema, item.name, "spec"),
                          "package_spec",
                          `${item.schema}.${item.name} (Spec)`,
                        );
                      }}
                    >
                      Spec kompilieren
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() => {
                        void compile(
                          packageOid(item.schema, item.name, "body"),
                          "package_body",
                          `${item.schema}.${item.name} (Body)`,
                        );
                      }}
                    >
                      Body kompilieren
                    </ContextMenuItem>
                  </>
                ) : (
                  <ContextMenuItem
                    onSelect={() => {
                      void compile(item.oid, "function", `${item.schema}.${item.name}`);
                    }}
                  >
                    Kompilieren
                  </ContextMenuItem>
                )
              ) : (
                <ContextMenuItem disabled>Kompilieren nicht unterstützt</ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

interface SidebarExtensionListProps {
  items: { name: string; version: string | null }[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

function SidebarExtensionList({ items, isLoading, isError, error }: SidebarExtensionListProps) {
  const navigate = useNavigate();
  const openExtensionTab = useTableTabs((state) => state.openExtensionTab);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        Lade Packages…
      </div>
    );
  }

  if (isError) {
    return <p className="py-1 text-sm text-destructive">{String(error)}</p>;
  }

  if (!items || items.length === 0) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton onClick={() => navigate({ to: "/available-extensions" })}>
            <SearchIcon className="text-muted-foreground" />
            <span className="truncate">Extensions durchsuchen</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton onClick={() => navigate({ to: "/available-extensions" })}>
          <SearchIcon className="text-muted-foreground" />
          <span className="truncate">Extensions durchsuchen</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      {items.map((item) => (
        <SidebarMenuItem key={item.name}>
          <SidebarMenuButton
            onClick={() => {
              openExtensionTab({ name: item.name });
              navigate({
                to: "/extensions/$name",
                params: { name: item.name },
              });
            }}
          >
            <PackageIcon className="text-muted-foreground" />
            <span className="truncate">
              {item.name}
              {item.version ? ` (${item.version})` : ""}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

function SidebarMatviewList({
  items,
}: {
  items: { schema: string; name: string; is_populated: boolean }[] | undefined;
}) {
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const activeConnection = useActiveConnection();
  const activeDatabase = useActiveDatabase();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [schema, setSchemaName] = useState("public");
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [withData, setWithData] = useState(true);
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!activeConnection || !name.trim() || !query.trim()) return;
    setSaving(true);
    try {
      await createMaterializedView(
        activeConnection.kind,
        effectiveConnectionString(activeConnection),
        {
          schema: schema.trim() || "public",
          name: name.trim(),
          query: query.trim(),
          with_data: withData,
        },
        activeDatabase ?? undefined,
      );
      toast.success(`Materialized View "${name.trim()}" erstellt.`);
      setName("");
      setQuery("");
      setDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["matviews"] });
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between py-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Materialized Views
        </p>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Materialized View erstellen"
        >
          <PlusIcon className="size-3" />
        </button>
      </div>
      {(!items || items.length === 0) && (
        <p className="py-1 text-xs text-muted-foreground">Keine vorhanden.</p>
      )}
      <SidebarMenu>
        {items?.map((item) => {
          const isActive = Boolean(
            matchRoute({
              to: "/matviews/$schema/$name",
              params: { schema: item.schema, name: item.name },
            }),
          );
          return (
            <SidebarMenuItem key={`${item.schema}.${item.name}`}>
              <SidebarMenuButton
                isActive={isActive}
                onClick={() => {
                  navigate({
                    to: "/matviews/$schema/$name",
                    params: { schema: item.schema, name: item.name },
                  });
                }}
              >
                <LayersIcon className="text-muted-foreground" />
                <span className="truncate">
                  {item.schema}.{item.name}
                  {item.is_populated ? "" : " (leer)"}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">Materialized View erstellen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Schema</Label>
                <Input
                  value={schema}
                  onChange={(e) => setSchemaName(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-8 text-xs font-mono"
                  placeholder="z. B. umsatz_pro_tag"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">SELECT-Abfrage</Label>
              <Textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-h-28 font-mono text-xs"
                placeholder="SELECT …"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <Switch checked={withData} onCheckedChange={setWithData} />
              Sofort befüllen (WITH DATA)
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Abbrechen
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={saving || !name.trim() || !query.trim()}
            >
              {saving ? "Erstellen…" : "Erstellen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SchemaManagerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const activeConnection = useActiveConnection();
  const activeDatabase = useActiveDatabase();
  const activeSchema = useActiveSchema();
  const setSchema = useDbSelectionStore((state) => state.setSchema);
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [cascade, setCascade] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshSchemas = () => {
    void queryClient.invalidateQueries({ queryKey: ["schemas"] });
  };

  const handleCreate = async () => {
    if (!activeConnection || !name.trim()) return;
    setBusy(true);
    try {
      await createSchema(
        activeConnection.kind,
        effectiveConnectionString(activeConnection),
        name.trim(),
        activeDatabase ?? undefined,
      );
      toast.success(`Schema "${name.trim()}" erstellt.`);
      setName("");
      refreshSchemas();
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDrop = async () => {
    if (!activeConnection || !activeSchema) return;
    if (
      !window.confirm(
        `Schema "${activeSchema}" wirklich löschen${cascade ? " (CASCADE – alle enthaltenen Objekte gehen verloren)" : ""}?`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await dropSchema(
        activeConnection.kind,
        effectiveConnectionString(activeConnection),
        activeSchema,
        cascade,
        activeDatabase ?? undefined,
      );
      toast.success(`Schema "${activeSchema}" gelöscht.`);
      setSchema(activeConnection.id, "public");
      setCascade(false);
      refreshSchemas();
      onOpenChange(false);
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Schemas verwalten</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Neues Schema</Label>
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 flex-1 text-xs font-mono"
                placeholder="z. B. analytics"
              />
              <Button
                size="sm"
                className="h-8"
                onClick={handleCreate}
                disabled={busy || !name.trim()}
              >
                Erstellen
              </Button>
            </div>
          </div>
          <div className="space-y-2 rounded-lg border border-destructive/20 p-3">
            <p className="text-xs">
              Aktives Schema: <span className="font-mono font-medium">{activeSchema ?? "—"}</span>
            </p>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={cascade} onCheckedChange={setCascade} />
              CASCADE (alle Objekte im Schema mit löschen)
            </label>
            <Button
              size="sm"
              variant="destructive"
              className="h-8 w-full"
              onClick={handleDrop}
              disabled={busy || !activeSchema}
            >
              Aktives Schema löschen
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SavedQueriesList() {
  const queries = useSavedQueriesStore((state) => state.queries);
  const deleteQuery = useSavedQueriesStore((state) => state.deleteQuery);
  const navigate = useNavigate();
  const tabs = useTableTabs((state) => state.tabs);
  const openSavedQueryTab = useTableTabs((state) => state.openSavedQueryTab);

  if (queries.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">Keine gespeicherten Queries.</p>;
  }

  return (
    <SidebarMenu>
      {queries.map((query) => {
        const existingTab = tabs.find((t) => t.kind === "query" && t.id === query.id);
        return (
          <SidebarMenuItem key={query.id}>
            <SidebarMenuButton
              isActive={Boolean(existingTab)}
              onClick={() => {
                if (!existingTab) {
                  openSavedQueryTab({ id: query.id, title: query.name, sql: query.sql });
                }
                navigate({ to: "/query/$id", params: { id: query.id } });
              }}
            >
              <FileCodeIcon className="text-muted-foreground" />
              <span className="truncate">{query.name}</span>
            </SidebarMenuButton>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                deleteQuery(query.id);
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover/menu-item:opacity-100"
            >
              <TrashIcon className="size-3.5" />
            </button>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

interface SidebarRoleListProps {
  items: { name: string; can_login: boolean }[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

function SidebarRoleList({ items, isLoading, isError, error }: SidebarRoleListProps) {
  const navigate = useNavigate();
  const openRoleTab = useTableTabs((state) => state.openRoleTab);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        Lade Benutzer…
      </div>
    );
  }

  if (isError) {
    return <p className="py-1 text-sm text-destructive">{String(error)}</p>;
  }

  if (!items || items.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">Keine Rollen gefunden.</p>;
  }

  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.name}>
          <SidebarMenuButton
            onClick={() => {
              openRoleTab({ name: item.name });
              navigate({
                to: "/users/$name",
                params: { name: item.name },
              });
            }}
          >
            <UsersIcon className="text-muted-foreground" />
            <span className="truncate">
              {item.name}
              {item.can_login ? "" : " (Rolle)"}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

interface SidebarSequenceListProps {
  items: { schema: string; name: string }[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

function SidebarSequenceList({ items, isLoading, isError, error }: SidebarSequenceListProps) {
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        Lade Sequenzen…
      </div>
    );
  }

  if (isError) {
    return <p className="py-1 text-sm text-destructive">{String(error)}</p>;
  }

  if (!items || items.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">Keine Sequenzen gefunden.</p>;
  }

  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={`${item.schema}.${item.name}`}>
          <SidebarMenuButton
            onClick={() => {
              navigate({ to: "/sequences" });
            }}
          >
            <ListOrderedIcon className="text-muted-foreground" />
            <span className="truncate">{item.name}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}
