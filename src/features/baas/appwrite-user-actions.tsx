import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
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
import { type AppwriteUser, appwriteDeleteUser, appwriteUpdateUserEmail } from "@/lib/db";

export function AppwriteUserActions({ id, user }: { id: string; user: AppwriteUser }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState(user.email ?? "");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await appwriteUpdateUserEmail(id, user.id, email.trim());
      setSuccess("E-Mail-Adresse geändert.");
      await queryClient.invalidateQueries({ queryKey: ["appwrite", id, "users"] });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await appwriteDeleteUser(id, user.id);
      setDeleteOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["appwrite", id, "users"] });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Input
          className="h-8 min-w-36 flex-1 text-xs"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-label={`${user.name || user.id}: E-Mail bearbeiten`}
          required
          disabled={busy}
        />
        <Button size="sm" variant="outline" type="submit" disabled={busy}>
          Speichern
        </Button>
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={() => setDeleteOpen(true)}
          disabled={busy}
        >
          <Trash2 className="size-3.5" /> Löschen
        </Button>
      </form>
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
            <AlertDialogTitle>Benutzer löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {user.email || user.id} wird endgültig gelöscht. Der Vorgang kann nicht rückgängig
              gemacht werden.
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
