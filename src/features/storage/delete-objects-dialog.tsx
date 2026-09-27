import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { s3DeleteObjects, s3DeletePrefix } from "@/lib/db";
import { ConfirmActionDialog } from "./confirm-action-dialog";
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
  rows: BrowserRow[] | null;
  versionsMode: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { connection, url } = useStorageConnection();
  const queryClient = useQueryClient();
  const [allVersions, setAllVersions] = useState(false);
  const [bypass, setBypass] = useState(false);

  useEffect(() => {
    setAllVersions(false);
    setBypass(false);
  }, [rows]);

  const folders = rows?.filter((row) => row.kind === "folder") ?? [];
  const objects = rows?.filter((row) => row.kind === "object") ?? [];
  const specificVersions = objects.some((row) => row.versionId);

  return (
    <ConfirmActionDialog
      open={rows !== null}
      title={
        rows?.length === 1
          ? `"${rows[0].name || rows[0].key}" löschen?`
          : `${rows?.length ?? 0} Einträge löschen?`
      }
      description={
        <>
          {folders.length ? `${folders.length} Ordner inklusive Inhalt` : ""}
          {folders.length && objects.length ? " und " : ""}
          {objects.length ? `${objects.length} Objekt(e)` : ""}
          {specificVersions
            ? " – die gewählten Versionen werden endgültig entfernt."
            : allVersions
              ? " werden mit allen Versionen endgültig gelöscht."
              : " werden gelöscht. In versionierten Buckets entsteht ein Delete-Marker."}
        </>
      }
      confirmLabel="Löschen"
      onOpenChange={(open) => !open && onClose()}
      onConfirm={async () => {
        if (!rows) return;
        const errors: string[] = [];
        let deleted = 0;
        if (objects.length) {
          const outcome = await s3DeleteObjects(
            url,
            bucket,
            objects.map((row) => ({ key: row.key, version_id: row.versionId ?? null })),
            bypass,
          );
          deleted += outcome.deleted;
          errors.push(...outcome.errors);
        }
        for (const folder of folders) {
          const outcome = await s3DeletePrefix(url, bucket, folder.key, {
            allVersions: allVersions || versionsMode,
            bypassGovernance: bypass,
          });
          deleted += outcome.deleted;
          errors.push(...outcome.errors);
        }
        await queryClient.invalidateQueries({ queryKey: ["s3", connection?.id] });
        onDeleted();
        if (errors.length)
          throw new Error(
            `${deleted} gelöscht, ${errors.length} Fehler:\n${errors.slice(0, 5).join("\n")}`,
          );
        toast.success(`${deleted} Objekt(e) gelöscht`);
      }}
    >
      {!specificVersions && folders.length > 0 && !versionsMode && (
        <label className="flex items-center justify-between gap-3 text-sm">
          Alle Versionen in Ordnern löschen
          <Switch
            checked={allVersions}
            onCheckedChange={setAllVersions}
            aria-label="Alle Versionen löschen"
          />
        </label>
      )}
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="flex flex-col gap-0.5">
          Governance-Sperre umgehen
          <span className="text-xs text-muted-foreground">
            Benötigt s3:BypassGovernanceRetention.
          </span>
        </span>
        <Switch checked={bypass} onCheckedChange={setBypass} aria-label="Governance umgehen" />
      </label>
    </ConfirmActionDialog>
  );
}
