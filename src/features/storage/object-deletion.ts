import type { VersioningStatus } from "@/lib/storage/s3";
import type { BrowserRow } from "./use-object-listing";

export function countDeleteTargets(rows: readonly BrowserRow[]) {
  let folders = 0;
  let currentObjects = 0;
  let versions = 0;
  let markers = 0;
  for (const row of rows) {
    if (row.kind === "folder") folders++;
    else if (!row.versionId) currentObjects++;
    else if (row.deleteMarker) markers++;
    else versions++;
  }
  return { folders, currentObjects, versions, markers };
}

const currentObjectEffect: Record<VersioningStatus | "Checking", string> = {
  Checking: "Der Versionsstatus wird geladen. Das Löschen aktueller Objekte kann endgültig sein.",
  Unknown: "Der Versionsstatus ist unbekannt. Das Löschen aktueller Objekte kann endgültig sein.",
  Enabled: "S3 setzt für aktuelle Objekte Löschmarker. Ihre bisherigen Versionen bleiben erhalten.",
  Suspended:
    "Die Versionierung ist pausiert. S3 entfernt vorhandene Null-Versionen endgültig und setzt Löschmarker. Versionen mit eigener ID bleiben erhalten.",
  Off: "Die Versionierung ist aus. Aktuelle Objekte werden endgültig gelöscht.",
};

export function deleteEffects(
  selection: ReturnType<typeof countDeleteTargets>,
  allFolderVersions: boolean,
  versioning: VersioningStatus | "Checking",
) {
  const effects: string[] = [];
  if (selection.folders && allFolderVersions)
    effects.push(
      "Alle Versionen und Löschmarker in den ausgewählten Ordnern werden endgültig entfernt.",
    );
  if (selection.versions) effects.push("Ausgewählte Objektversionen werden endgültig gelöscht.");
  if (selection.markers)
    effects.push(
      "Ausgewählte Löschmarker werden entfernt. Frühere Objektversionen können dadurch wieder sichtbar werden.",
    );
  if (selection.currentObjects || (selection.folders && !allFolderVersions))
    effects.push(currentObjectEffect[versioning]);
  return effects.join(" ");
}
