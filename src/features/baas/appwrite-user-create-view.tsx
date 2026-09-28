import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { appwriteCreateUser } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function AppwriteUserCreateView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const feature = useNewFeatureVisibility<HTMLFormElement>("baas.appwrite.users-manage");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await appwriteCreateUser(id, email.trim(), password, name.trim());
      setEmail("");
      setPassword("");
      setName("");
      setSuccess("Benutzer erstellt.");
      await queryClient.invalidateQueries({ queryKey: ["appwrite", id, "users"] });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      ref={feature.ref}
      className="mt-4 rounded-xl border bg-background/50 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium">Benutzer erstellen</p>
        {feature.isNew && <NewBadge />}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Input
          className="h-8 min-w-32 flex-1 text-xs"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="E-Mail"
          aria-label="Neue Appwrite-Benutzer-E-Mail"
          required
          disabled={busy}
        />
        <Input
          className="h-8 min-w-32 flex-1 text-xs"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Passwort"
          aria-label="Neues Appwrite-Benutzerpasswort"
          minLength={8}
          required
          disabled={busy}
        />
        <Input
          className="h-8 min-w-32 flex-1 text-xs"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name"
          aria-label="Neuer Appwrite-Benutzername"
          maxLength={128}
          disabled={busy}
        />
        <Button size="sm" type="submit" disabled={busy}>
          <Plus className="size-3.5" /> Erstellen
        </Button>
      </div>
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
    </form>
  );
}
