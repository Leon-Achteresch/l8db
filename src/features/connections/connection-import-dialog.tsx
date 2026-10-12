import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ExternalImportPanel } from "./connection-import/external-import-panel";
import { type ImportSource, ImportSourcePicker } from "./connection-import/import-source-picker";
import { L8dbImportPanel } from "./connection-import/l8db-import-panel";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DESCRIPTIONS: Record<ImportSource, string> = {
  l8db: "Exportdatei aus l8db (JSON) oder Toad for Oracle (XML) auswählen. Bestehende Profile bleiben unverändert, es wird keine Verbindung aufgebaut. Passwörter werden nach dem Import regulär im Profil erfasst.",
  dbeaver:
    "data-sources.json aus dem DBeaver-Workspace (.dbeaver) wählen oder den Standardpfad erkennen lassen. Liegt credentials-config.json daneben, werden Benutzer und Passwörter in den Schlüsselbund übernommen.",
  datagrip:
    "dataSources.xml und dataSources.local.xml aus .idea oder dem IDE-Konfigurationsordner wählen, für SSH zusätzlich options/sshConfigs.xml. Passwörter liegen im JetBrains-Schlüsselbund und müssen neu eingegeben werden.",
  navicat:
    "Navicat-Verbindungsexport (.ncx) wählen. Gespeicherte Passwörter werden entschlüsselt und im Schlüsselbund abgelegt.",
};

export function ConnectionImportDialog({ open, onOpenChange }: Props) {
  const [source, setSource] = useState<ImportSource>("l8db");
  const close = () => onOpenChange(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Verbindungen importieren</DialogTitle>
          <DialogDescription>{DESCRIPTIONS[source]}</DialogDescription>
        </DialogHeader>
        <ImportSourcePicker value={source} onChange={setSource} />
        {source === "l8db" ? (
          <L8dbImportPanel onClose={close} />
        ) : (
          <ExternalImportPanel key={source} source={source} onClose={close} />
        )}
      </DialogContent>
    </Dialog>
  );
}
