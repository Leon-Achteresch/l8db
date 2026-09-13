import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingsRow } from "@/features/settings/settings-row";
import { pickImportFile } from "@/lib/import-file";
import {
  applyPortableWorkspace,
  exportPortableWorkspace,
  type PortableWorkspace,
  parsePortableWorkspace,
} from "@/lib/portable-workspace";

export function PortableWorkspacePanel() {
  const [preview, setPreview] = useState<PortableWorkspace | null>(null);
  const [undo, setUndo] = useState<(() => void) | null>(null);
  const exportFile = async () => {
    try {
      const data = JSON.stringify(exportPortableWorkspace(), null, 2);
      const path = await save({
        defaultPath: "l8db-workspace.json",
        filters: [{ name: "Arbeitsumgebung", extensions: ["json"] }],
      });
      if (path) {
        await writeTextFile(path, data);
        toast.success("Arbeitsumgebung exportiert");
      }
    } catch (error) {
      toast.error(String(error));
    }
  };
  const importFile = async () => {
    try {
      const file = await pickImportFile("json");
      if (file) setPreview(parsePortableWorkspace(file.text));
    } catch (error) {
      toast.error(String(error));
    }
  };
  return (
    <>
      <SettingsRow
        title="Portable Arbeitsumgebung"
        description="Einstellungen, Hotkeys, Spaltenlayouts, Favoriten und Filter als JSON übertragen. Verbindungen und Zugangsdaten sind nicht enthalten; Objektzuordnungen verwenden die vorhandenen Verbindungs-IDs."
      >
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void exportFile()}>
            Exportieren
          </Button>
          <Button size="sm" variant="outline" onClick={() => void importFile()}>
            Importieren
          </Button>
          {undo && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                try {
                  undo();
                  setUndo(null);
                  toast.success("Import rückgängig gemacht");
                } catch (error) {
                  toast.error(String(error));
                }
              }}
            >
              Import rückgängig
            </Button>
          )}
        </div>
      </SettingsRow>
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Arbeitsumgebung übernehmen</DialogTitle>
            <DialogDescription>
              Die folgenden Bereiche werden ersetzt. Filter können SQL und fachliche Werte
              enthalten. Prüfen Sie die Herkunft der Datei. Sie können den Import in dieser Ansicht
              rückgängig machen.
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <ul className="space-y-1 text-sm">
              <li>{Object.keys(preview.settings).length} Einstellungen</li>
              <li>{Object.keys(preview.hotkeys).length} Tastenkürzel</li>
              <li>{Object.keys(preview.layouts).length} Tabellenlayouts</li>
              <li>{Object.values(preview.profiles).flat().length} Spaltenprofile</li>
              <li>{preview.favorites.length} Favoriten</li>
              <li>{Object.values(preview.views).flat().length} gespeicherte Tabellenansichten</li>
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>
              Abbrechen
            </Button>
            <Button
              onClick={() => {
                if (!preview) return;
                try {
                  const restore = applyPortableWorkspace(preview);
                  setUndo(() => restore);
                  setPreview(null);
                  toast.success("Arbeitsumgebung importiert");
                } catch (error) {
                  toast.error(String(error));
                }
              }}
            >
              Ersetzen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
