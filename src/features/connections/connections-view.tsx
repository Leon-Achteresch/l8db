import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Download,
  FolderTree,
  Group,
  KeyRound,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Server,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { disconnectActiveConnection } from "@/features/connections/disconnect-button";
import {
  connectionUser,
  groupByServer,
  groupKey,
  type HostGroupRule,
  matchesConnectionQuery,
  type ServerGroup,
  sortServerGroups,
  suggestHostPattern,
} from "@/lib/connection-groups";
import { providerFor } from "@/lib/connection-url";
import {
  type SavedConnection,
  sortConnectionsByName,
  useConnectionsStore,
} from "@/lib/connections";
import { capabilitiesFor } from "@/lib/providers";
import { activateConnectionWithToast, useConnectionSwitch } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";
import { getTransactionForConnection } from "@/lib/transactions";
import { ConnectionBulkEditDialog } from "./connection-bulk-edit-dialog";
import { ConnectionEditor } from "./connection-editor";
import { ConnectionExportDialog } from "./connection-export-dialog";
import { ConnectionGroupNav } from "./connection-group-nav";
import { ConnectionImportDialog } from "./connection-import-dialog";
import { ConnectionPickCard } from "./connection-pick-card";
import { HostGroupRulesDialog } from "./host-group-rules-dialog";

export function ConnectionsView() {
  const connections = useConnectionsStore((state) => state.connections);
  const activeId = useConnectionsStore((state) => state.activeId);
  const favoriteServerKeys = useConnectionsStore((state) => state.favoriteServerKeys);
  const serverOrder = useConnectionsStore((state) => state.serverOrder);
  const hostGroupRules = useConnectionsStore((state) => state.hostGroupRules);
  const [rulesDialog, setRulesDialog] = useState<{
    draft: Omit<HostGroupRule, "id"> | null;
  } | null>(null);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [template, setTemplate] = useState<SavedConnection | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState("all");
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkGroup, setBulkGroup] = useState<ServerGroup | null>(null);
  const [deleteGroup, setDeleteGroup] = useState<ServerGroup | null>(null);
  const toggleFavorite = useConnectionsStore((state) => state.toggleFavorite);
  const toggleServerFavorite = useConnectionsStore((state) => state.toggleServerFavorite);
  const setServerOrder = useConnectionsStore((state) => state.setServerOrder);
  const duplicateConnection = useConnectionsStore((state) => state.duplicateConnection);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const selected = connections.find((connection) => connection.id === editorId);
  const deleting = connections.find((connection) => connection.id === deleteId);
  const activeConnection = connections.find((connection) => connection.id === activeId);
  const filtered = sortConnectionsByName(
    connections.filter((connection) => {
      if (
        favoritesOnly &&
        !connection.favorite &&
        !favoriteServerKeys.includes(groupKey(connection, hostGroupRules))
      )
        return false;
      return matchesConnectionQuery(connection, query);
    }),
  );
  const allGroups = sortServerGroups(
    groupByServer(sortConnectionsByName(connections), hostGroupRules),
    favoriteServerKeys,
    serverOrder,
  );
  const groups = sortServerGroups(
    groupByServer(filtered, hostGroupRules),
    favoriteServerKeys,
    serverOrder,
  );
  const grouped = allGroups.some((group) => group.connections.length > 1 || group.ruleId);
  const effectiveKey =
    selectedKey === "all" || groups.some((group) => group.key === selectedKey)
      ? selectedKey
      : "all";
  const displayGroups =
    grouped && effectiveKey !== "all"
      ? groups.filter((group) => group.key === effectiveKey)
      : groups;
  const activeGroupKey = activeConnection ? groupKey(activeConnection, hostGroupRules) : null;

  function openEditor(id: string | null, from: SavedConnection | null = null) {
    setTemplate(from);
    setEditorId(id);
  }

  function renderCard(connection: SavedConnection) {
    return (
      <ConnectionPickCard
        key={connection.id}
        connection={connection}
        active={activeId === connection.id}
        onOpen={() => {
          if (activeId === connection.id) void connect(null);
          else void connect(connection.id);
        }}
        onEdit={() => openEditor(connection.id)}
        onDelete={() => setDeleteId(connection.id)}
        onDuplicate={() => duplicateConnection(connection.id)}
        onCreateSimilar={() => openEditor("new", connection)}
        onToggleFavorite={() => toggleFavorite(connection.id)}
      />
    );
  }

  function setSchemasToUser(group: ServerGroup) {
    const ids = new Set(group.connections.map((connection) => connection.id));
    const users = new Map(
      group.connections
        .map((connection) => [connection.id, connectionUser(connection)] as const)
        .filter((entry) => entry[1]),
    );
    if (users.size === 0) {
      toast.error("Für diese Connections wurde kein Username gefunden.");
      return;
    }
    useConnectionsStore.setState((state) => ({
      connections: state.connections.map((connection) => {
        const user = users.get(connection.id);
        return ids.has(connection.id) && user ? { ...connection, schemas: [user] } : connection;
      }),
    }));
    toast.success(`Schema-Filter für ${users.size} Connections auf Username gesetzt`);
  }

  function moveServerGroup(key: string, delta: number) {
    const index = allGroups.findIndex((group) => group.key === key);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= allGroups.length) return;
    const next = allGroups.map((group) => group.key);
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    setServerOrder(next);
  }

  async function connect(id: string | null) {
    if (useConnectionSwitch.getState().isSwitching) return;
    if (id === null) {
      await disconnectActiveConnection(queryClient);
      return;
    }
    if (await activateConnectionWithToast(id)) {
      await navigate({ to: "/" });
    }
  }

  function renderGroup(group: ServerGroup) {
    const provider = providerFor(group.connections[0]);
    return (
      <section key={group.key} className="flex flex-col gap-3">
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/95 px-3 py-2 shadow-2xs backdrop-blur-sm">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-muted/40">
              <ProviderLogo providerId={provider.id} kind={group.kind} className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate font-mono text-sm font-semibold tracking-tight">
                  {group.label}
                </h2>
                {favoriteServerKeys.includes(group.key) && (
                  <Star className="size-3 shrink-0 fill-current text-amber-500" />
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {group.connections.length}{" "}
                {group.connections.length === 1 ? "Verbindung" : "Verbindungen"}
                {` · ${provider.name}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="xs"
              onClick={() => openEditor("new", group.connections[0])}
            >
              <Plus className="size-3.5" />
              Verbindung hinzufügen
            </Button>
            {group.connections.length > 1 && !group.ruleId && group.kind === "oracle" && (
              <Button variant="outline" size="xs" onClick={() => setBulkGroup(group)}>
                <Pencil className="size-3.5" />
                Host &amp; Service
              </Button>
            )}
            {group.connections.length > 1 && capabilitiesFor(group.kind).schemas && (
              <Button variant="outline" size="xs" onClick={() => setSchemasToUser(group)}>
                <KeyRound className="size-3.5" />
                Schema = User
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label={`${group.label} Aktionen`}>
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => toggleServerFavorite(group.key)}>
                  <Star
                    className={
                      favoriteServerKeys.includes(group.key)
                        ? "size-3.5 fill-current text-amber-500"
                        : "size-3.5"
                    }
                  />
                  {favoriteServerKeys.includes(group.key) ? "Aus Favoriten" : "Als Favorit"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    const first = group.connections[0];
                    setRulesDialog({
                      draft:
                        group.ruleId || !first
                          ? null
                          : { name: "", pattern: suggestHostPattern(first) },
                    });
                  }}
                >
                  <Group className="size-3.5" />
                  {group.ruleId ? "Gruppierung bearbeiten" : "Ähnliche Hosts gruppieren"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={allGroups[0]?.key === group.key}
                  onSelect={() => moveServerGroup(group.key, -1)}
                >
                  <ArrowUp className="size-3.5" />
                  Nach oben
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={allGroups.at(-1)?.key === group.key}
                  onSelect={() => moveServerGroup(group.key, 1)}
                >
                  <ArrowDown className="size-3.5" />
                  Nach unten
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleteGroup(group)}>
                  <Trash2 className="size-3.5" />
                  Alle löschen
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {group.connections.map(renderCard)}
        </div>
      </section>
    );
  }

  return (
    <main
      data-tour="connections-page"
      className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background"
    >
      <div className="relative flex h-full min-h-0 w-full flex-col p-4 md:p-6">
        <header className="mb-4 flex shrink-0 items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight text-foreground md:text-2xl">
              {editorId ? (selected ? "Verbindung bearbeiten" : "Neue Verbindung") : "Verbindungen"}
            </h1>
            {!editorId && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {connections.length === 0
                  ? "Starte mit einer neuen Verbindung oder importiere bestehende Profile."
                  : `${connections.length} ${connections.length === 1 ? "Verbindung" : "Verbindungen"}${grouped ? ` auf ${allGroups.length} ${allGroups.length === 1 ? "Host" : "Hosts"}` : ""}${activeConnection ? ` · ${activeConnection.name} aktiv` : ""}`}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {editorId && connections.length === 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportOpen(true)}
                aria-label="Verbindungen importieren"
              >
                <Upload className="size-4" />
                Import
              </Button>
            )}
            {!editorId && (
              <>
                {connections.length > 0 && (
                  <>
                    <div className="relative w-48 min-w-0 sm:w-64 md:w-80">
                      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Name, Host, User suchen…"
                        aria-label="Verbindungen suchen"
                        className="h-9 pl-8 text-xs"
                      />
                    </div>
                    <Button
                      variant={favoritesOnly ? "secondary" : "outline"}
                      size="icon-sm"
                      aria-pressed={favoritesOnly}
                      aria-label={favoritesOnly ? "Alle anzeigen" : "Nur Favoriten"}
                      onClick={() => setFavoritesOnly((value) => !value)}
                      className={favoritesOnly ? "text-amber-500 border-amber-500/30" : ""}
                    >
                      <Star className={favoritesOnly ? "size-4 fill-current" : "size-4"} />
                    </Button>
                  </>
                )}
                <Button
                  variant="default"
                  size="sm"
                  data-tour="connection-add"
                  onClick={() => openEditor("new")}
                  className="shadow-xs"
                >
                  <Plus className="size-4" />
                  Neue Verbindung
                </Button>
                {connections.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon-sm" aria-label="Weitere Aktionen">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                        <Upload className="size-3.5" />
                        Import
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setExportOpen(true)}>
                        <Download className="size-3.5" />
                        Export
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setRulesDialog({ draft: null })}>
                        <FolderTree className="size-3.5" />
                        Gruppen-Regeln
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </>
            )}
            {connections.length > 0 && editorId && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/">
                  <ArrowLeft className="size-4" />
                  Arbeitsplatz
                </Link>
              </Button>
            )}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          {editorId ? (
            <ConnectionEditor
              key={`${editorId}:${template?.id ?? ""}`}
              connection={selected}
              template={template ?? undefined}
              onSaved={() => openEditor(null)}
              onCancel={() => openEditor(null)}
            />
          ) : connections.length === 0 ? (
            <section className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
              <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-2xl border border-dashed border-border/80 p-12 text-center shadow-xs">
                <div className="grid size-12 place-items-center rounded-xl bg-muted/80 text-muted-foreground">
                  <Server className="size-6" />
                </div>
                <h3 className="text-base font-semibold">Noch keine Verbindung vorhanden</h3>
                <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                  Erstelle deine erste Datenbankverbindung oder importiere gespeicherte Profile aus
                  anderen Tools.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Button size="sm" data-tour="connection-add" onClick={() => openEditor("new")}>
                    <Plus className="size-4" />
                    Neue Verbindung
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                    <Upload className="size-4" />
                    Profile importieren
                  </Button>
                </div>
              </div>
            </section>
          ) : favoritesOnly && filtered.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center">
              <div className="grid size-10 place-items-center rounded-xl bg-amber-500/10 text-amber-500">
                <Star className="size-5" />
              </div>
              <p className="text-sm font-semibold">Keine Favoriten vorhanden</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Markiere Verbindungen mit dem Stern, um sie direkt griffbereit zu haben.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => setFavoritesOnly(false)}
              >
                Alle Verbindungen anzeigen
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center">
              <div className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
                <Search className="size-5" />
              </div>
              <p className="text-sm font-semibold">Keine Treffer</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Es wurde keine Verbindung für „{query.trim()}“ gefunden.
              </p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setQuery("")}>
                Suche zurücksetzen
              </Button>
            </div>
          ) : grouped ? (
            <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/70 bg-card/20 shadow-xs">
              <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-border/70 bg-muted/15 p-3 md:block xl:w-72">
                <ConnectionGroupNav
                  groups={groups}
                  selectedKey={effectiveKey}
                  allCount={filtered.length}
                  favoriteKeys={favoriteServerKeys}
                  activeGroupKey={activeGroupKey}
                  onSelect={setSelectedKey}
                />
              </aside>
              <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
                <div className="mb-4 md:hidden">
                  <ConnectionGroupNav
                    groups={groups}
                    selectedKey={effectiveKey}
                    allCount={filtered.length}
                    favoriteKeys={favoriteServerKeys}
                    activeGroupKey={activeGroupKey}
                    onSelect={setSelectedKey}
                  />
                </div>
                <div className="flex flex-col gap-8">{displayGroups.map(renderGroup)}</div>
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border/70 bg-card/20 p-4 md:p-6 shadow-xs">
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.map(renderCard)}
              </div>
            </div>
          )}
        </div>
      </div>
      {exportOpen && (
        <ConnectionExportDialog
          open={exportOpen}
          connections={connections}
          onOpenChange={setExportOpen}
        />
      )}
      {rulesDialog && (
        <HostGroupRulesDialog
          open
          draft={rulesDialog.draft}
          onOpenChange={(open) => {
            if (!open) setRulesDialog(null);
          }}
        />
      )}
      {importOpen && <ConnectionImportDialog open={importOpen} onOpenChange={setImportOpen} />}
      {bulkGroup && (
        <ConnectionBulkEditDialog
          open
          group={bulkGroup}
          onOpenChange={(open) => {
            if (!open) setBulkGroup(null);
          }}
        />
      )}
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Verbindung entfernen?</AlertDialogTitle>
            <AlertDialogDescription>
              „{deleting?.name}“ und die gespeicherten Zugangsdaten werden aus l8db entfernt. Die
              Datenbank selbst bleibt erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteId) {
                  if (getTransactionForConnection(deleteId)) {
                    toast.error("Schließe zuerst die offene Transaktion ab.");
                    return;
                  }
                  useConnectionsStore.getState().removeConnection(deleteId);
                  useTableTabs.getState().clearTabsForConnection(deleteId);
                  if (editorId === deleteId || !useConnectionsStore.getState().connections.length)
                    setEditorId(null);
                  toast.success("Verbindung entfernt");
                  setDeleteId(null);
                }
              }}
            >
              Entfernen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={Boolean(deleteGroup)}
        onOpenChange={(open) => {
          if (!open) setDeleteGroup(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Alle Verbindungen entfernen?</AlertDialogTitle>
            <AlertDialogDescription>
              Alle {deleteGroup?.connections.length} Verbindungen auf „{deleteGroup?.label}“ und die
              gespeicherten Zugangsdaten werden aus l8db entfernt. Die Datenbank selbst bleibt
              erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleteGroup) return;
                const ids = deleteGroup.connections.map((connection) => connection.id);
                if (ids.some((id) => getTransactionForConnection(id))) {
                  toast.error("Schließe zuerst die offenen Transaktionen ab.");
                  return;
                }
                for (const id of ids) {
                  useConnectionsStore.getState().removeConnection(id);
                  useTableTabs.getState().clearTabsForConnection(id);
                }
                if (!useConnectionsStore.getState().connections.length) setEditorId(null);
                else if (editorId && ids.includes(editorId)) setEditorId(null);
                toast.success(`${ids.length} Verbindungen entfernt`);
                setDeleteGroup(null);
              }}
            >
              Alle entfernen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
