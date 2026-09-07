import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { serializeConnectionExport } from "@/lib/connection-export";
import { providerFor } from "@/lib/connection-url";
import type { SavedConnection } from "@/lib/connections";

interface Props {
  open: boolean;
  connections: SavedConnection[];
  onOpenChange: (open: boolean) => void;
}

export function ConnectionExportDialog({ open, connections, onOpenChange }: Props) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(connections.map((connection) => connection.id)),
  );
  const [busy, setBusy] = useState(false);
  const allSelected = selected.size === connections.length && connections.length > 0;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function exportSelected() {
    const chosen = connections.filter((connection) => selected.has(connection.id));
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      const path = await save({
        defaultPath: "l8db-verbindungen.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await writeTextFile(path, serializeConnectionExport(chosen));
      toast.success(
        chosen.length === 1
          ? "1 Verbindung ohne Geheimnisse exportiert"
          : `${chosen.length} Verbindungen ohne Geheimnisse exportiert`,
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Verbindungen exportieren</DialogTitle>
          <DialogDescription>
            Passwörter, Tokens, SSH-Geheimnisse und Tunnelports werden nicht exportiert. Name,
            Anbieter, Tags, Farbe und Verbindungsparameter bleiben erhalten.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 border-b pb-2 text-xs text-muted-foreground">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(value) =>
                setSelected(
                  value ? new Set(connections.map((connection) => connection.id)) : new Set(),
                )
              }
              aria-label="Alle auswählen"
            />
            Alle auswählen
          </label>
          <div className="max-h-72 overflow-y-auto">
            {connections.map((connection) => (
              <label
                key={connection.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-muted"
              >
                <Checkbox
                  checked={selected.has(connection.id)}
                  onCheckedChange={() => toggle(connection.id)}
                  aria-label={connection.name}
                />
                <span className="min-w-0 flex-1 truncate">{connection.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {providerFor(connection).name}
                </span>
              </label>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Abbrechen
          </Button>
          <Button onClick={() => void exportSelected()} disabled={busy || selected.size === 0}>
            {selected.size === 0 ? "Exportieren" : `${selected.size} exportieren`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
