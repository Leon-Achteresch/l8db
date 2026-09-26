import type { Permission } from "@/lib/extensions/contracts";

export const PERMISSION_LABELS: Record<Permission, string> = {
  "database:read": "Datenbanken lesen",
  "database:write": "In Datenbanken schreiben",
  network: "Auf freigegebene Internetadressen zugreifen",
  "filesystem:extension-storage": "Eigenen Speicher nutzen",
  filesystem: "Ausgewählte Dateien lesen und schreiben",
  "clipboard:read": "Zwischenablage lesen",
  "clipboard:write": "In die Zwischenablage schreiben",
  "process:execute": "Kommandozeilen-Programme ausführen",
  "connections:read": "Gespeicherte Verbindungen samt Passwörtern lesen",
  "connections:write": "Verbindungen anlegen und aktualisieren",
};
