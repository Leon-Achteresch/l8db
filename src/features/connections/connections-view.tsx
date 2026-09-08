import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Download, Plus, Star, Upload } from "lucide-react";
import { motion } from "motion/react";
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
import { groupByServer } from "@/lib/connection-groups";
import { providerFor } from "@/lib/connection-url";
import { type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { SPRING_LAYOUT } from "@/lib/ease";
import { ensurePassword } from "@/lib/password-prompt";
import { activateConnectionWithToast, useConnectionSwitch } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";
import { getTransactionForConnection } from "@/lib/transactions";
import { openConnectionWindow } from "@/lib/windows";
import { ConnectionEditor } from "./connection-editor";
import { ConnectionExportDialog } from "./connection-export-dialog";
import { ConnectionImportDialog } from "./connection-import-dialog";
import { ConnectionPickCard } from "./connection-pick-card";
import { SavedConnectionChip } from "./saved-connection-chip";

export function ConnectionsView() {
  const connections = useConnectionsStore((state) => state.connections);
  const activeId = useConnectionsStore((state) => state.activeId);
  const [editorId, setEditorId] = useState<string | null>(connections.length ? null : "new");
  const [template, setTemplate] = useState<SavedConnection | null>(null);
  const isSwitching = useConnectionSwitch((state) => state.isSwitching);
  const switchTargetId = useConnectionSwitch((state) => state.targetId);
  const connectingId = isSwitching ? (switchTargetId ?? "disconnect") : null;
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const toggleFavorite = useConnectionsStore((state) => state.toggleFavorite);
  const duplicateConnection = useConnectionsStore((state) => state.duplicateConnection);
  const navigate = useNavigate();
  const selected = connections.find((connection) => connection.id === editorId);
  const deleting = connections.find((connection) => connection.id === deleteId);
  const favoriteCount = connections.filter((connection) => connection.favorite).length;
  const visible = favoritesOnly
    ? connections.filter((connection) => connection.favorite)
    : connections;
  const groups = groupByServer(visible);
  const grouped = groups.some((group) => group.connections.length > 1);

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
        connecting={connectingId === connection.id}
        onOpen={() => {
          if (activeId === connection.id) void connect(null);
          else void connect(connection.id);
        }}
        onOpenWindow={() => void openInWindow(connection)}
        onEdit={() => openEditor(connection.id)}
        onDelete={() => setDeleteId(connection.id)}
        onDuplicate={() => duplicateConnection(connection.id)}
        onCreateSimilar={() => openEditor("new", connection)}
        onToggleFavorite={() => toggleFavorite(connection.id)}
      />
    );
  }

  async function openInWindow(connection: SavedConnection) {
    if (!(await ensurePassword(connection.id))) return;
    const current = useConnectionsStore
      .getState()
      .connections.find((entry) => entry.id === connection.id);
    if (!current) {
      toast.error("Verbindung wurde entfernt.");
      return;
    }
    await openConnectionWindow(current);
  }

  async function connect(id: string | null) {
    if (useConnectionSwitch.getState().isSwitching) return;
    if (await activateConnectionWithToast(id)) {
      await navigate({ to: "/" });
    }
  }

  return (
    <main
      data-tour="connections-page"
      className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background"
    >
      <div className="relative mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col px-4 py-4">
        <header className="mb-4 flex shrink-0 items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground">l8db</p>
            <h1 className="mt-0.5 truncate text-xl font-semibold tracking-tight">
              {editorId ? "Verbindung" : "Datenbank wählen"}
            </h1>
            {!editorId && (
              <p className="mt-1 text-[13px] text-muted-foreground">
                Verbindung öffnen oder eine neue anlegen.
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!editorId && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setImportOpen(true)}
                  aria-label="Verbindungen importieren"
                >
                  <Upload className="size-4" />
                  Import
                </Button>
                {connections.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setExportOpen(true)}
                    aria-label="Verbindungen exportieren"
                  >
                    <Download className="size-4" />
                    Export
                  </Button>
                )}
              </>
            )}
            {connections.length > 0 && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/">
                  <ArrowLeft className="size-4" />
                  Arbeitsplatz
                </Link>
              </Button>
            )}
          </div>
        </header>
        {!editorId && connections.length > 0 && (
          <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
            <Button
              variant={favoritesOnly ? "default" : "outline"}
              size="sm"
              aria-pressed={favoritesOnly}
              onClick={() => setFavoritesOnly((value) => !value)}
            >
              <Star className={favoritesOnly ? "size-4 fill-current" : "size-4"} />
              Nur Favoriten
              {favoriteCount > 0 && <span className="text-xs opacity-70">({favoriteCount})</span>}
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-tour="connection-add"
              onClick={() => openEditor("new")}
            >
              <Plus className="size-4" />
              Neu
            </Button>
          </div>
        )}
        {editorId && connections.length > 0 && (
          <div className="mb-3 flex shrink-0 gap-2 overflow-x-auto pb-1">
            {connections.map((connection) => (
              <SavedConnectionChip
                key={connection.id}
                connection={connection}
                active={activeId === connection.id}
                connecting={connectingId === connection.id}
                onOpen={() => {
                  if (activeId === connection.id) void connect(null);
                  else void connect(connection.id);
                }}
                onEdit={() => openEditor(connection.id)}
                onDelete={() => setDeleteId(connection.id)}
                onToggleFavorite={() => toggleFavorite(connection.id)}
              />
            ))}
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col">
          {editorId ? (
            <ConnectionEditor
              key={`${editorId}:${template?.id ?? ""}`}
              connection={selected}
              template={template ?? undefined}
              onSaved={() => openEditor(null)}
              onCancel={() => openEditor(connections.length ? null : "new")}
            />
          ) : (
            <section className="flex min-h-0 flex-1 items-center overflow-y-auto">
              {favoritesOnly && visible.length === 0 ? (
                <div className="flex w-full flex-col items-center gap-2 py-16 text-center">
                  <Star className="size-8 text-muted-foreground/60" />
                  <p className="text-sm font-medium">Noch keine Favoriten</p>
                  <p className="max-w-sm text-xs text-muted-foreground">
                    Markiere Verbindungen mit dem Stern, um sie hier schneller zu finden.
                  </p>
                  <Button variant="outline" size="sm" onClick={() => setFavoritesOnly(false)}>
                    Alle Verbindungen anzeigen
                  </Button>
                </div>
              ) : grouped ? (
                <div className="flex w-full flex-col gap-5 self-start py-1">
                  {groups.map((group) => (
                    <section key={group.key} className="flex flex-col gap-2.5">
                      <header className="flex items-center gap-2 border-b pb-1.5">
                        <span className="grid size-6 shrink-0 place-items-center rounded-md border bg-muted/50">
                          <ProviderLogo
                            providerId={providerFor(group.connections[0]).id}
                            kind={group.kind}
                            className="size-3.5"
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[13px] font-medium">
                            {group.label}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            {group.connections.length}{" "}
                            {group.connections.length === 1 ? "Schema" : "Schemas"}
                          </span>
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => openEditor("new", group.connections[0])}
                        >
                          <Plus className="size-3.5" />
                          Schema hinzufügen
                        </Button>
                      </header>
                      <motion.div
                        layout
                        transition={{ layout: SPRING_LAYOUT }}
                        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
                      >
                        {group.connections.map(renderCard)}
                      </motion.div>
                    </section>
                  ))}
                </div>
              ) : (
                <motion.div
                  layout
                  transition={{ layout: SPRING_LAYOUT }}
                  className="grid w-full grid-cols-1 gap-3 py-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
                >
                  {visible.map(renderCard)}
                </motion.div>
              )}
            </section>
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
      {importOpen && <ConnectionImportDialog open={importOpen} onOpenChange={setImportOpen} />}
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
                  if (editorId === deleteId) setEditorId(null);
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
    </main>
  );
}
