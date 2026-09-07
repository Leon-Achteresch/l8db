import { CheckIcon, LayoutGridIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { ContextMenuLabel, ContextMenuSeparator } from "@/components/ui/context-menu";
import type { TableLayoutProfile } from "@/lib/table-column-prefs";

type DataTableLayoutProfilesProps = {
  profiles: TableLayoutProfile[];
  onSave: (name: string) => void;
  onApply: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
};

export function DataTableLayoutProfiles({
  profiles,
  onSave,
  onApply,
  onRename,
  onDelete,
}: DataTableLayoutProfilesProps) {
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const commitSave = () => {
    if (newName.trim() === "") return;
    onSave(newName);
    setNewName("");
  };

  const commitRename = () => {
    if (!renamingId || renameValue.trim() === "") {
      setRenamingId(null);
      return;
    }
    onRename(renamingId, renameValue);
    setRenamingId(null);
  };

  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuLabel>Layouts</ContextMenuLabel>
      {profiles.length === 0 && (
        <div className="px-2 py-1 text-[11px] text-muted-foreground">
          Noch kein Layout gespeichert.
        </div>
      )}
      <div className="max-h-40 overflow-y-auto">
        {profiles.map((profile) =>
          renamingId === profile.id ? (
            <div key={profile.id} className="flex items-center gap-1 px-2 py-1">
              <input
                value={renameValue}
                // biome-ignore lint/a11y/noAutofocus: Umbenennen startet gezielt im Eingabefeld
                autoFocus
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") commitRename();
                  if (event.key === "Escape") setRenamingId(null);
                }}
                className="h-6 min-w-0 flex-1 rounded border border-border bg-background px-1.5 text-xs outline-none"
              />
              <button
                type="button"
                title="Übernehmen"
                onClick={commitRename}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-accent cursor-pointer"
              >
                <CheckIcon className="size-3.5" />
              </button>
            </div>
          ) : (
            <div
              key={profile.id}
              className="flex items-center gap-1 rounded px-2 py-1 hover:bg-accent"
            >
              <button
                type="button"
                title="Layout anwenden"
                onClick={() => onApply(profile.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs cursor-pointer"
              >
                <LayoutGridIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{profile.name}</span>
              </button>
              <button
                type="button"
                title="Umbenennen"
                onClick={() => {
                  setRenamingId(profile.id);
                  setRenameValue(profile.name);
                }}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-muted cursor-pointer"
              >
                <PencilIcon className="size-3" />
              </button>
              <button
                type="button"
                title="Löschen"
                onClick={() => onDelete(profile.id)}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded text-destructive hover:bg-muted cursor-pointer"
              >
                <Trash2Icon className="size-3" />
              </button>
            </div>
          ),
        )}
      </div>
      <div className="flex items-center gap-1 px-2 py-1">
        <input
          value={newName}
          placeholder="Aktuelles Layout speichern…"
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") commitSave();
          }}
          className="h-6 min-w-0 flex-1 rounded border border-border bg-background px-1.5 text-xs outline-none placeholder:text-muted-foreground/60"
        />
        <button
          type="button"
          title="Layout speichern"
          disabled={newName.trim() === ""}
          onClick={commitSave}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-accent disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
        >
          <PlusIcon className="size-3.5" />
        </button>
      </div>
    </>
  );
}
