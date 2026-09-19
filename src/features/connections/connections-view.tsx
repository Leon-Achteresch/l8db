import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Upload } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { disconnectActiveConnection } from "@/features/connections/disconnect-button";
import {
  groupByServer,
  groupKey,
  type HostGroupRule,
  matchesConnectionQuery,
  type ServerGroup,
  sortServerGroups,
} from "@/lib/connection-groups";
import {
  type SavedConnection,
  sortConnectionsByName,
  useConnectionsStore,
} from "@/lib/connections";
import { activateConnectionWithToast, useConnectionSwitch } from "@/lib/ssh";
import { ConnectionBulkEditDialog } from "./connection-bulk-edit-dialog";
import { ConnectionEditor } from "./connection-editor";
import { ConnectionExportDialog } from "./connection-export-dialog";
import { ConnectionImportDialog } from "./connection-import-dialog";
import { ConnectionPickCard } from "./connection-pick-card";
import { DeleteConnectionDialog } from "./connections-view/delete-connection-dialog";
import { DeleteServerGroupDialog } from "./connections-view/delete-group-dialog";
import { ConnectionsEmptyState } from "./connections-view/empty-state";
import { ConnectionsGroupedLayout } from "./connections-view/grouped-layout";
import { ConnectionsNoFavoritesState } from "./connections-view/no-favorites-state";
import { ConnectionsNoResultsState } from "./connections-view/no-results-state";
import { ConnectionServerGroupSection } from "./connections-view/server-group-section";
import { setSchemasToUser } from "./connections-view/set-schemas-to-user";
import { ConnectionsToolbar } from "./connections-view/toolbar";
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
    return (
      <ConnectionServerGroupSection
        key={group.key}
        group={group}
        favoriteServerKeys={favoriteServerKeys}
        allGroups={allGroups}
        openEditor={openEditor}
        setBulkGroup={setBulkGroup}
        setSchemasToUser={setSchemasToUser}
        toggleServerFavorite={toggleServerFavorite}
        setRulesDialog={setRulesDialog}
        moveServerGroup={moveServerGroup}
        setDeleteGroup={setDeleteGroup}
        renderCard={renderCard}
      />
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
              <ConnectionsToolbar
                connections={connections}
                query={query}
                setQuery={setQuery}
                favoritesOnly={favoritesOnly}
                setFavoritesOnly={setFavoritesOnly}
                openEditor={openEditor}
                setImportOpen={setImportOpen}
                setExportOpen={setExportOpen}
                setRulesDialog={setRulesDialog}
              />
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
            <ConnectionsEmptyState openEditor={openEditor} setImportOpen={setImportOpen} />
          ) : favoritesOnly && filtered.length === 0 ? (
            <ConnectionsNoFavoritesState setFavoritesOnly={setFavoritesOnly} />
          ) : filtered.length === 0 ? (
            <ConnectionsNoResultsState query={query} setQuery={setQuery} />
          ) : grouped ? (
            <ConnectionsGroupedLayout
              groups={groups}
              effectiveKey={effectiveKey}
              filtered={filtered}
              favoriteServerKeys={favoriteServerKeys}
              activeGroupKey={activeGroupKey}
              setSelectedKey={setSelectedKey}
              displayGroups={displayGroups}
              renderGroup={renderGroup}
            />
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
      <DeleteConnectionDialog
        deleting={deleting}
        deleteId={deleteId}
        setDeleteId={setDeleteId}
        editorId={editorId}
        setEditorId={setEditorId}
      />
      <DeleteServerGroupDialog
        deleteGroup={deleteGroup}
        setDeleteGroup={setDeleteGroup}
        editorId={editorId}
        setEditorId={setEditorId}
      />
    </main>
  );
}
