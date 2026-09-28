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
  type SupabaseBucket,
  supabaseCreateBucket,
  supabaseDeleteBucket,
  supabaseUpdateBucketPublic,
} from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function SupabaseBucketManageView({
  reference,
  selected,
  enabled,
  onCreated,
  onDeleted,
}: {
  reference: string;
  selected: SupabaseBucket | undefined;
  enabled: boolean;
  onCreated: (id: string) => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.supabase.bucket-manage");
  const [name, setName] = useState("");
  const [newPublic, setNewPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["supabase", reference, "buckets"] });
    await queryClient.invalidateQueries({ queryKey: ["supabase", reference, "bucket-details"] });
  }

  async function create() {
    const bucket = name.trim();
    if (
      !bucket ||
      bucket === "." ||
      bucket === ".." ||
      bucket.includes("/") ||
      bucket.includes("\\")
    ) {
      setError("Bitte einen gültigen Bucket-Namen eingeben.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await supabaseCreateBucket(reference, bucket, newPublic);
      setName("");
      setSuccess(`${bucket} erstellt.`);
      await refresh();
      onCreated(bucket);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function changeVisibility() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await supabaseUpdateBucketPublic(reference, selected.id, !selected.public);
      setSuccess(`${selected.name} ist jetzt ${selected.public ? "privat" : "öffentlich"}.`);
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
      await supabaseDeleteBucket(reference, selected.id);
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
      {!enabled && (
        <p className="mt-2 text-xs text-muted-foreground">
          Projekt API Key für die Bucket-Verwaltung hinterlegen.
        </p>
      )}
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <Input
          className="h-8 min-w-40 flex-1 text-xs"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Neuer Bucket"
          aria-label="Neuer Bucket-Name"
          disabled={!enabled || busy}
          required
        />
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={newPublic}
            onChange={(event) => setNewPublic(event.target.checked)}
            disabled={!enabled || busy}
          />{" "}
          Öffentlich
        </label>
        <Button size="sm" type="submit" disabled={!enabled || busy}>
          <Plus className="size-3.5" /> Erstellen
        </Button>
      </form>
      {selected && (
        <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void changeVisibility()}
            disabled={!enabled || busy}
          >
            {selected.public ? "Privat machen" : "Öffentlich machen"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDeleteOpen(true)}
            disabled={!enabled || busy}
          >
            <Trash2 className="size-3.5" /> Bucket löschen
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
              {selected?.name} wird gelöscht, sofern der Bucket leer ist. Der Vorgang kann nicht
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
