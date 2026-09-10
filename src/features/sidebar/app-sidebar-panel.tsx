import { useMemo, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import {
  BracesIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  ColumnsIcon,
  DatabaseIcon,
  EyeIcon,
  FileCodeIcon,
  FilterIcon,
  LayersIcon,
  ListOrderedIcon,
  PackageIcon,
  SearchIcon,
  SettingsIcon,
  SquareTerminalIcon,
  TableIcon,
  TrashIcon,
  UsersIcon,
  WrenchIcon,
} from "lucide-react";

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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { dropTable, truncateTable } from "@/lib/db";
import {
  useActiveDatabase,
  useActiveSchema,
  useDbSelectionStore,
} from "@/lib/db-selection";
import {
  useColumnsQuery,
  useDatabasesQuery,
  useExtensionsQuery,
  useFunctionsQuery,
  useRolesQuery,
  useSchemasQuery,
  useSequencesQuery,
  useTablesQuery,
  useViewsQuery,
} from "@/lib/queries";
import { useSavedQueriesStore } from "@/lib/saved-queries";
import { selectSidebarPanelWidth, useSidebarPanel } from "@/lib/sidebar-panel";
import { useTableTabs } from "@/lib/table-tabs";
import { TableSearchModal } from "@/features/sidebar/table-search-modal";

export function AppSidebarPanel() {
  const connections = useConnectionsStore((state) => state.connections);
  const setActiveId = useConnectionsStore((state) => state.setActiveId);
  const activeConnection = useActiveConnection();
  const panelWidth = useSidebarPanel(selectSidebarPanelWidth);
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
  const {
    data: functions,
    isLoading: functionsLoading,
    isError: functionsError,
    error: functionsErrorValue,
  } = useFunctionsQuery();
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

  const [sidebarTab, setSidebarTab] = useState<
    "tables" | "views" | "queries" | "functions" | "extensions" | "roles" | "sequences"
  >("tables");

  return (
    <Sidebar
      collapsible="none"
      style={{ width: panelWidth }}
      className="hidden min-h-0 min-w-0 shrink-0 overflow-hidden border-r md:flex"
    >
      <SidebarHeader className="gap-3.5 border-b p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <DatabaseIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="truncate">
                  {activeConnection ? activeConnection.name : "Keine Verbindung"}
                </span>
                {activeConnection?.tags?.map((tag, index) => (
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
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate">{connection.name}</span>
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
              onValueChange={(v) => setSidebarTab(v as typeof sidebarTab)}
            >
              <TabsList className="w-full">
                <TabsTrigger
                  value="tables"
                  className="flex-1 px-0"
                  aria-label="Tabellen"
                >
                  <TableIcon className="size-4" />
                </TabsTrigger>
                <TabsTrigger
                  value="views"
                  className="flex-1 px-0"
                  aria-label="Views"
                >
                  <EyeIcon className="size-4" />
                </TabsTrigger>
                <TabsTrigger
                  value="functions"
                  className="flex-1 px-0"
                  aria-label="Funktionen"
                >
                  <BracesIcon className="size-4" />
                </TabsTrigger>
                <TabsTrigger
                  value="extensions"
                  className="flex-1 px-0"
                  aria-label="Packages"
                >
                  <PackageIcon className="size-4" />
                </TabsTrigger>
                <TabsTrigger
                  value="roles"
                  className="flex-1 px-0"
                  aria-label="Benutzer"
                >
                  <UsersIcon className="size-4" />
                </TabsTrigger>
                <TabsTrigger
                  value="queries"
                  className="flex-1 px-0"
                  aria-label="Queries"
                >
                  <FileCodeIcon className="size-4" />
                </TabsTrigger>
                <TabsTrigger
                  value="sequences"
                  className="flex-1 px-0"
                  aria-label="Sequenzen"
                >
                  <ListOrderedIcon className="size-4" />
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        ) : null}
        <SidebarGroup>
          <SidebarGroupLabel>
            {sidebarTab === "tables"
              ? "Tabellen"
              : sidebarTab === "views"
                ? "Views"
                : sidebarTab === "functions"
                  ? "Funktionen"
                  : sidebarTab === "extensions"
                    ? "Packages"
                    : sidebarTab === "roles"
                      ? "Benutzer & Rollen"
                      : sidebarTab === "sequences"
                        ? "Sequenzen"
                        : "Gespeicherte Queries"}
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
            ) : sidebarTab === "views" ? (
              <SidebarEntityList
                items={views}
                isLoading={viewsLoading}
                isError={viewsError}
                error={viewsErrorValue}
                emptyMessage="Keine Views gefunden."
                type="view"
                matchRoute={matchRoute}
              />
            ) : sidebarTab === "functions" ? (
              <SidebarFunctionList
                items={functions}
                isLoading={functionsLoading}
                isError={functionsError}
                error={functionsErrorValue}
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
      </SidebarContent>
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
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    kind: "drop" | "truncate";
    schema: string;
    name: string;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const navigate = useNavigate();
  const openViewEditorTab = useTableTabs((state) => state.openViewEditorTab);
  const openAlterTableTab = useTableTabs((state) => state.openAlterTableTab);
  const activeConnection = useActiveConnection();
  const activeDatabase = useActiveDatabase();
  const queryClient = useQueryClient();
  const { data: columns } = useColumnsQuery(
    type === "table" ? "BASE TABLE" : "VIEW",
  );

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

  const filtered = useMemo(() => {
    if (!items) return undefined;
    const q = search.trim().toLowerCase();
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
  }, [items, search, columnsByTable]);

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

  const handleConfirmAction = async () => {
    if (!confirmAction || !activeConnection) return;
    setActionLoading(true);
    try {
      const connStr = activeConnection.connectionString;
      const kind = activeConnection.kind;
      if (confirmAction.kind === "drop") {
        await dropTable(kind, connStr, confirmAction.schema, confirmAction.name, activeDatabase ?? undefined);
      } else {
        await truncateTable(kind, connStr, confirmAction.schema, confirmAction.name, activeDatabase ?? undefined);
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
    const id = crypto.randomUUID();
    const sql = `SELECT * FROM ${itemSchema}."${itemName}";`;
    const counter = useTableTabs.getState().queryCounter + 1;
    useTableTabs.setState((state) => ({
      tabs: [
        ...state.tabs,
        {
          kind: "query" as const,
          id,
          title: `Query ${counter}`,
          sql,
        },
      ],
      queryCounter: counter,
    }));
    navigate({ to: "/query/$id", params: { id } });
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
      <div className="flex items-center gap-1 px-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <SidebarInput
            placeholder={type === "table" ? "Tabellen & Spalten…" : "Views & Spalten…"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <button
          type="button"
          onClick={() => setSearchModalOpen(true)}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Erweiterte Suche"
          title="Erweiterte Suche mit Regex & SQL WHERE"
        >
          <FilterIcon className="size-3.5" />
        </button>
      </div>
      <TableSearchModal open={searchModalOpen} onOpenChange={setSearchModalOpen} />
      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
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
        <p className="px-2 py-1 text-sm text-muted-foreground">
          Keine Treffer.
        </p>
      ) : (
        <SidebarMenu>
          {filtered?.map((item) => {
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
                    <ContextMenuTrigger asChild>
                      {menuButton}
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        onSelect={() => handleOpenInEditor(item.schema, item.name)}
                      >
                        <SquareTerminalIcon />
                        Im Editor öffnen
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() => handleAlterTable(item.schema, item.name)}
                      >
                        <WrenchIcon />
                        Alter Table
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        onSelect={() =>
                          setConfirmAction({ kind: "truncate", schema: item.schema, name: item.name })
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
                  menuButton
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
  items: { schema: string; name: string; identity_args: string; oid: string }[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

function SidebarFunctionList({
  items,
  isLoading,
  isError,
  error,
}: SidebarFunctionListProps) {
  const navigate = useNavigate();
  const openFunctionTab = useTableTabs((state) => state.openFunctionTab);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        Lade Funktionen…
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
      <p className="px-2 py-1 text-sm text-muted-foreground">
        Keine Funktionen gefunden.
      </p>
    );
  }

  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.oid}>
          <SidebarMenuButton
            onClick={() => {
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
            <BracesIcon className="text-muted-foreground" />
            <span className="truncate">
              {item.name}
              {item.identity_args ? `(${item.identity_args})` : "()"}
            </span>
          </SidebarMenuButton>
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

function SidebarExtensionList({
  items,
  isLoading,
  isError,
  error,
}: SidebarExtensionListProps) {
  const navigate = useNavigate();
  const openExtensionTab = useTableTabs((state) => state.openExtensionTab);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        Lade Packages…
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
      <p className="px-2 py-1 text-sm text-muted-foreground">
        Keine Packages installiert.
      </p>
    );
  }

  return (
    <SidebarMenu>
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

function SavedQueriesList() {
  const queries = useSavedQueriesStore((state) => state.queries);
  const deleteQuery = useSavedQueriesStore((state) => state.deleteQuery);
  const navigate = useNavigate();
  const tabs = useTableTabs((state) => state.tabs);

  if (queries.length === 0) {
    return (
      <p className="px-2 py-1 text-sm text-muted-foreground">
        Keine gespeicherten Queries.
      </p>
    );
  }

  return (
    <SidebarMenu>
      {queries.map((query) => {
        const existingTab = tabs.find(
          (t) => t.kind === "query" && t.id === query.id,
        );
        return (
          <SidebarMenuItem key={query.id}>
            <SidebarMenuButton
              isActive={Boolean(existingTab)}
              onClick={() => {
                if (!existingTab) {
                  useTableTabs.setState((state) => ({
                    tabs: [
                      ...state.tabs,
                      {
                        kind: "query",
                        id: query.id,
                        title: query.name,
                        sql: query.sql,
                      },
                    ],
                  }));
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

function SidebarRoleList({
  items,
  isLoading,
  isError,
  error,
}: SidebarRoleListProps) {
  const navigate = useNavigate();
  const openRoleTab = useTableTabs((state) => state.openRoleTab);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        Lade Benutzer…
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
      <p className="px-2 py-1 text-sm text-muted-foreground">
        Keine Rollen gefunden.
      </p>
    );
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

function SidebarSequenceList({
  items,
  isLoading,
  isError,
  error,
}: SidebarSequenceListProps) {
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        Lade Sequenzen…
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
      <p className="px-2 py-1 text-sm text-muted-foreground">
        Keine Sequenzen gefunden.
      </p>
    );
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
