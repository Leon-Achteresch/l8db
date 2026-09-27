import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { s3DeleteBucket } from "@/lib/db";
import { ConfirmActionDialog } from "./confirm-action-dialog";
import { useStorageConnection } from "./use-storage-connection";

export function DeleteBucketDialog({
  bucket,
  onOpenChange,
}: {
  bucket: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { connection, url } = useStorageConnection();
  const queryClient = useQueryClient();
  const [confirmText, setConfirmText] = useState("");
  const [force, setForce] = useState(false);

  useEffect(() => {
    setConfirmText("");
    setForce(false);
  }, [bucket]);

  return (
    <ConfirmActionDialog
      open={bucket !== null}
      title={`Bucket "${bucket}" löschen?`}
      description={
        force
          ? "Alle Objekte, Versionen und unvollständigen Uploads werden unwiderruflich gelöscht, danach der Bucket selbst."
          : "Nur leere Buckets können gelöscht werden."
      }
      confirmLabel="Bucket löschen"
      disabled={force && confirmText !== bucket}
      onOpenChange={onOpenChange}
      onConfirm={async () => {
        if (!bucket) return;
        await s3DeleteBucket(url, bucket, force);
        window.dispatchEvent(
          new CustomEvent("l8db:request-close-tab", { detail: `bucket:${bucket}` }),
        );
        await queryClient.invalidateQueries({ queryKey: ["s3", connection?.id] });
      }}
    >
      <label className="flex items-center justify-between gap-3 text-sm">
        Inhalt vorher leeren
        <Switch checked={force} onCheckedChange={setForce} aria-label="Inhalt vorher leeren" />
      </label>
      {force ? (
        <Input
          aria-label="Bucket-Namen bestätigen"
          placeholder={`Zum Bestätigen "${bucket}" eingeben`}
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
        />
      ) : null}
    </ConfirmActionDialog>
  );
}
