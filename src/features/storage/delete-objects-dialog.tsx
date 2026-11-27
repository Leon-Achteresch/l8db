import { useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { s3DeleteObjects, s3DeletePrefix } from "@/lib/db";
import { parseVersioning } from "@/lib/storage/s3";
import { runStorageJob } from "@/lib/storage/transfers";
import { ConfirmActionDialog } from "./confirm-action-dialog";
import { countDeleteTargets, deleteEffects } from "./object-deletion";
import { useBucketConfig } from "./use-bucket-config";
import type { BrowserRow } from "./use-object-listing";
import { useStorageConnection } from "./use-storage-connection";

export function DeleteObjectsDialog({
  bucket,
  rows,
  versionsMode,
  onClose,
  onDeleted,
}: {
  bucket: string;
  rows: BrowserRow[];
  versionsMode: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { connection, url } = useStorageConnection();
  const queryClient = useQueryClient();
  const [allVersions, setAllVersions] = useState(false);
  const [bypass, setBypass] = useState(false);
  const controlsId = useId();

  const selection = useMemo(() => countDeleteTargets(rows), [rows]);
  const folderCount = selection.folders;
  const objectCount = rows.length - folderCount;
  const specificVersions = selection.versions + selection.markers > 0;
  const permanentFolders = folderCount > 0 && (allVersions || versionsMode);
  const currentObjects = selection.currentObjects > 0 || (folderCount > 0 && !permanentFolders);
  const versioning = useBucketConfig(bucket, "versioning", currentObjects);
  const status = versioning.checking
    ? "Checking"
    : versioning.error
      ? "Unknown"
      : parseVersioning(versioning.data);
  const permanent = permanentFolders || specificVersions || (currentObjects && status === "Off");

  return (
    <ConfirmActionDialog
      open
      title={
        rows.length === 1
          ? `"${rows[0].name || rows[0].key}" löschen?`
          : `${rows.length} Einträge löschen?`
      }
      description={
        <>
          {folderCount > 0 && `${folderCount} Ordner inklusive Inhalt`}
          {folderCount > 0 && objectCount > 0 && " und "}
          {objectCount > 0 && `${objectCount} ${objectCount === 1 ? "Objekt" : "Objekte"}`}.{" "}
          {deleteEffects(selection, permanentFolders, status)}
        </>
      }
      confirmLabel={permanent ? "Endgültig löschen" : "Löschen"}
      onOpenChange={(open) => !open && onClose()}
      onConfirm={async () => {
        const errors: string[] = [];
        let deleted = 0;
        if (objectCount) {
          const objects = rows.filter((row) => row.kind === "object");
          const outcome = await s3DeleteObjects(
            url,
            bucket,
            objects.map((row) => ({ key: row.key, version_id: row.versionId ?? null })),
            bypass,
          );
          deleted += outcome.deleted;
          errors.push(...outcome.errors);
        }
        for (const folder of rows) {
          if (folder.kind !== "folder") continue;
          const outcome = await runStorageJob(
            connection,
            bucket,
            `Ordner löschen · ${folder.name || folder.key}`,
            (jobId) =>
              s3DeletePrefix(url, bucket, folder.key, {
                allVersions: permanentFolders,
                bypassGovernance: bypass,
                jobId,
              }),
          );
          deleted += outcome.deleted;
          errors.push(...outcome.errors);
        }
        await queryClient.invalidateQueries({
          queryKey: ["s3", connection?.id],
          predicate: ({ queryKey }) =>
            queryKey[3] === bucket && (queryKey[2] !== "config" || queryKey[4] != null),
        });
        onDeleted();
        if (errors.length)
          throw new Error(
            `${deleted} gelöscht, ${errors.length} Fehler:\n${errors.slice(0, 5).join("\n")}`,
          );
        toast.success(`${deleted} ${deleted === 1 ? "Objekt" : "Objekte"} gelöscht`);
      }}
    >
      {!specificVersions && folderCount > 0 && !versionsMode && (
        <label
          htmlFor={`${controlsId}-versions`}
          className="flex items-center justify-between gap-3 text-sm"
        >
          Alle Versionen in Ordnern löschen
          <Switch
            id={`${controlsId}-versions`}
            checked={allVersions}
            onCheckedChange={setAllVersions}
            aria-label="Alle Versionen löschen"
          />
        </label>
      )}
      <label
        htmlFor={`${controlsId}-governance`}
        className={`flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm ${bypass ? "bg-destructive/10 text-destructive" : ""}`}
      >
        <span className="flex flex-col gap-0.5">
          Auch gesperrte Objekte löschen
          <span className={`text-xs ${bypass ? "" : "text-muted-foreground"}`}>
            Umgeht die Governance-Aufbewahrung (s3:BypassGovernanceRetention).
          </span>
        </span>
        <Switch
          id={`${controlsId}-governance`}
          checked={bypass}
          onCheckedChange={setBypass}
          aria-label="Governance umgehen"
        />
      </label>
    </ConfirmActionDialog>
  );
}
