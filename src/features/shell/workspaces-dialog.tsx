import { CheckIcon, LayersIcon, PencilIcon, PlusIcon, TrashIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useActiveConnection } from "@/lib/connections";
import { useAllSchemaObjectsQuery } from "@/lib/queries";
import { useSplitView } from "@/lib/split-view";
import { type Tab, tabKey, useTableTabs } from "@/lib/table-tabs";
import {
  createWorkspaceSnapshot,
  findWorkspaceByName,
  restoreWorkspaceSnapshot,
  useWorkspacesStore,
  type Workspace,
  type WorkspaceOpenMode,
  workspacesFor,
} from "@/lib/workspaces";

interface WorkspacesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTabKey: string | null;
  onNavigate: (tab: Tab) => void;
}

export function WorkspacesDialog({
  open,
  onOpenChange,
  activeTabKey,
  onNavigate,
}: WorkspacesDialogProps) {
  const connection = useActiveConnection();
  const tabs = useTableTabs((state) => state.tabs);
  const replaceTabs = useTableTabs((state) => state.replaceTabs);
  const panes = useSplitView((state) => state.panes);
  const focusedPane = useSplitView((state) => state.focusedPane);
  const applySplit = useSplitView((state) => state.applySnapshot);
  const byConnection = useWorkspacesStore((state) => state.byConnection);
  const saveWorkspace = useWorkspacesStore((state) => state.saveWorkspace);
  const renameWorkspace = useWorkspacesStore((state) => state.renameWorkspace);
  const deleteWorkspace = useWorkspacesStore((state) => state.deleteWorkspace);
  const { data: objects } = useAllSchemaObjectsQuery();

  const [name, setName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setRenamingId(null);
  }, [open]);

  const workspaces = useMemo(
    () =>
      [...workspacesFor(byConnection, connection?.id)].sort((a, b) =>
        a.name.localeCompare(b.name, "de"),
      ),
    [byConnection, connection?.id],
  );

  const knownObjectKeys = useMemo(() => {
    if (!objects) return null;
    return [...objects.tables, ...objects.views].map((item) => `${item.schema}.${item.name}`);
  }, [objects]);

  const currentSnapshot = () => createWorkspaceSnapshot({ tabs, panes, focusedPane, activeTabKey });

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    saveWorkspace(trimmed, currentSnapshot());
    setName("");
    toast.success(`Arbeitsplatzstand "${trimmed}" gespeichert`);
  };

  const handleOpen = (workspace: Workspace, mode: WorkspaceOpenMode) => {
    const { snapshot, warnings } = restoreWorkspaceSnapshot(
      currentSnapshot(),
      workspace.snapshot,
      mode,
      knownObjectKeys,
    );
    replaceTabs(snapshot.tabs);
    applySplit(snapshot.panes, snapshot.focusedPane);
    for (const warning of warnings) toast.warning(warning);
    const target = snapshot.tabs.find((tab) => tabKey(tab) === snapshot.activeTabKey);
    if (target) onNavigate(target);
    onOpenChange(false);
  };

  const handleRename = (workspace: Workspace) => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === workspace.name) {
      setRenamingId(null);
      return;
    }
    const clash = findWorkspaceByName(workspaces, trimmed);
    if (clash && clash.id !== workspace.id) {
      toast.error(`Es gibt bereits einen Stand mit dem Namen "${trimmed}"`);
      return;
    }
    renameWorkspace(workspace.id, trimmed);
    setRenamingId(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Arbeitsplatzstände</DialogTitle>
          <DialogDescription>
            Tabs, SQL-Text und Split-Anordnung dieser Verbindung. Beim Öffnen wird kein SQL
            ausgeführt; Ergebnisse und Transaktionen werden nicht wiederhergestellt.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name des Arbeitsplatzstands…"
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSave();
            }}
          />
          <Button size="sm" onClick={handleSave} disabled={!name.trim() || !connection}>
            <PlusIcon className="size-4" />
            Speichern
          </Button>
        </div>

        {workspaces.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Noch keine Arbeitsplatzstände gespeichert.
          </p>
        ) : (
          <ScrollArea className="max-h-80">
            <ul className="flex flex-col gap-1 pr-2">
              {workspaces.map((workspace) => (
                <li
                  key={workspace.id}
                  className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5"
                >
                  <LayersIcon className="size-4 shrink-0 text-muted-foreground" />
                  {renamingId === workspace.id ? (
                    <>
                      <Input
                        autoFocus
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") handleRename(workspace);
                          if (event.key === "Escape") setRenamingId(null);
                        }}
                        className="h-7"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        onClick={() => handleRename(workspace)}
                        title="Umbenennen bestätigen"
                      >
                        <CheckIcon className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        onClick={() => setRenamingId(null)}
                        title="Abbrechen"
                      >
                        <XIcon className="size-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{workspace.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {workspace.snapshot.tabs.length} Tabs
                          {workspace.snapshot.panes.length > 1
                            ? `, ${workspace.snapshot.panes.length} Panes`
                            : ""}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleOpen(workspace, "replace")}
                      >
                        Öffnen
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleOpen(workspace, "merge")}
                      >
                        Ergänzen
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        onClick={() => {
                          setRenamingId(workspace.id);
                          setRenameValue(workspace.name);
                        }}
                        title="Umbenennen"
                      >
                        <PencilIcon className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-destructive"
                        onClick={() => deleteWorkspace(workspace.id)}
                        title="Löschen"
                      >
                        <TrashIcon className="size-4" />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
