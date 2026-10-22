import { useQueryClient } from "@tanstack/react-query";
import { Eraser, Globe2, Lock, Settings2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type SupabaseBucket, supabaseDeleteBucket } from "@/lib/db";
import {
  type SupabaseStorageBucketSettings,
  supabaseStudioStorageBucketEmpty,
  supabaseStudioStorageBucketUpdate,
} from "@/lib/db/supabase-studio-storage";
import { formatBytes, storageQueryKey } from "./storage-format";
import { SupabaseStorageBucketDialog } from "./supabase-storage-bucket-dialog";
import { SupabaseStorageConfirmDialog } from "./supabase-storage-confirm-dialog";

export function SupabaseStorageBucketHeader({
  reference,
  bucket,
  canManage,
  onChanged,
  onDeleted,
}: {
  reference: string;
  bucket: SupabaseBucket;
  canManage: boolean;
  onChanged: (bucket: SupabaseBucket) => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<"edit" | "empty" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      setDialog(null);
      await queryClient.invalidateQueries({ queryKey: storageQueryKey(reference) });
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setBusy(false);
    }
  }

  const save = (settings: SupabaseStorageBucketSettings) =>
    run(async () => {
      await supabaseStudioStorageBucketUpdate(reference, bucket.id, settings);
      toast.success(`Bucket ${bucket.name} gespeichert.`);
      onChanged({
        ...bucket,
        public: settings.public,
        file_size_limit: settings.fileSizeLimit,
        allowed_mime_types: settings.allowedMimeTypes.length ? settings.allowedMimeTypes : null,
      });
    });

  const reason = canManage ? undefined : "Benötigt einen Secret oder service_role Key.";
  const known = canManage || bucket.created_at !== null;

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-background/50 p-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-semibold">
          {known &&
            (bucket.public ? (
              <Globe2 className="size-4 text-primary" />
            ) : (
              <Lock className="size-4 text-muted-foreground" />
            ))}
          <span className="truncate">{bucket.name}</span>
          {known && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-normal text-muted-foreground">
              {bucket.public ? "Öffentlich" : "Privat"}
            </span>
          )}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {known ? (
            <>
              Max. Dateigröße:{" "}
              {bucket.file_size_limit ? formatBytes(bucket.file_size_limit) : "kein Bucket-Limit"} ·
              MIME-Typen:{" "}
              {bucket.allowed_mime_types?.length ? bucket.allowed_mime_types.join(", ") : "alle"}
            </>
          ) : (
            "Direkt geöffnet. Sichtbarkeit und Limits sind mit diesem Key nicht lesbar."
          )}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDialog("edit")}
          disabled={!canManage || busy}
          title={reason}
        >
          <Settings2 className="size-3.5" /> Bearbeiten
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDialog("empty")}
          disabled={!canManage || busy}
          title={reason}
        >
          <Eraser className="size-3.5" /> Leeren
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDialog("delete")}
          disabled={!canManage || busy}
          title={reason}
        >
          <Trash2 className="size-3.5" /> Löschen
        </Button>
      </div>
      {dialog === "edit" && (
        <SupabaseStorageBucketDialog
          open
          bucket={bucket}
          busy={busy}
          onOpenChange={(open) => setDialog(open ? "edit" : null)}
          onSubmit={(_, settings) => void save(settings)}
        />
      )}
      <SupabaseStorageConfirmDialog
        open={dialog === "empty"}
        title={`Bucket ${bucket.name} leeren?`}
        description="Alle Dateien im Bucket werden endgültig gelöscht. Supabase leert große Buckets im Hintergrund; das kann einige Zeit dauern."
        action="Bucket leeren"
        busy={busy}
        onOpenChange={(open) => setDialog(open ? "empty" : null)}
        onConfirm={() =>
          void run(async () => {
            await supabaseStudioStorageBucketEmpty(reference, bucket.id);
            toast.success(`Bucket ${bucket.name} wird geleert.`);
          })
        }
      />
      <SupabaseStorageConfirmDialog
        open={dialog === "delete"}
        title={`Bucket ${bucket.name} löschen?`}
        description="Der Bucket wird endgültig gelöscht. Supabase löscht nur leere Buckets; leere ihn vorher."
        action="Bucket löschen"
        busy={busy}
        onOpenChange={(open) => setDialog(open ? "delete" : null)}
        onConfirm={() =>
          void run(async () => {
            await supabaseDeleteBucket(reference, bucket.id);
            toast.success(`Bucket ${bucket.name} gelöscht.`);
            onDeleted();
          })
        }
      />
    </div>
  );
}
