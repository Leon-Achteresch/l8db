import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type AppwriteBucket,
  appwriteCreateBucket,
  appwriteDeleteBucket,
  appwriteRenameBucket,
} from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function AppwriteBucketManageView({
  id,
  selected,
  onCreated,
  onDeleted,
}: {
  id: string;
  selected: AppwriteBucket | undefined;
  onCreated: (bucketId: string) => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.appwrite.bucket-manage");
  const [bucketId, setBucketId] = useState("");
  const [name, setName] = useState("");
  const [rename, setRename] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["appwrite", id, "buckets"] });
  }

  async function create() {
    const nextId = bucketId.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/.test(nextId) || !name.trim()) {
      setError("Bucket-ID und Name prüfen.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await appwriteCreateBucket(id, nextId, name.trim());
      setBucketId("");
      setName("");
      setSuccess(`${nextId} erstellt.`);
      await refresh();
      onCreated(nextId);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function renameSelected() {
    if (!selected || !rename.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await appwriteRenameBucket(id, selected.id, rename.trim());
      setRename("");
      setSuccess("Bucket umbenannt.");
      await refresh();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await appwriteDeleteBucket(id, selected.id);
      setDeleteOpen(false);
      setSuccess(`${selected.name} gelöscht.`);
      onDeleted();
      await refresh();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={feature.ref} className="mt-4 rounded-xl border bg-background/50 p-3">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-medium">Buckets verwalten</h4>
        {feature.isNew && <NewBadge />}
      </div>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <Input
          className="h-8 min-w-28 flex-1 font-mono text-xs"
          value={bucketId}
          onChange={(event) => setBucketId(event.target.value)}
          placeholder="Bucket-ID"
          aria-label="Neue Bucket-ID"
          maxLength={36}
          required
          disabled={busy}
        />
        <Input
          className="h-8 min-w-28 flex-1 text-xs"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name"
          aria-label="Neuer Bucket-Name"
          maxLength={128}
          required
          disabled={busy}
        />
        <Button size="sm" type="submit" disabled={busy}>
          <Plus className="size-3.5" /> Erstellen
        </Button>
      </form>
      {selected && (
        <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
          <form
            className="flex min-w-0 flex-1 gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void renameSelected();
            }}
          >
            <Input
              className="h-8 min-w-28 flex-1 text-xs"
              value={rename}
              onChange={(event) => setRename(event.target.value)}
              placeholder={selected.name}
              aria-label="Bucket umbenennen"
              maxLength={128}
              required
              disabled={busy}
            />
            <Button size="sm" variant="outline" type="submit" disabled={busy}>
              Umbenennen
            </Button>
          </form>
          <Button size="sm" variant="outline" onClick={() => setDeleteOpen(true)} disabled={busy}>
            <Trash2 className="size-3.5" /> Löschen
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {success}
        </p>
      )}
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!busy) setDeleteOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bucket löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {selected?.name} und seine Dateien werden endgültig gelöscht. Der Vorgang kann nicht
              rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
            >
              {busy ? "Löscht…" : "Löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
