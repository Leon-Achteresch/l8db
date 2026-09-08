import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActiveConnection } from "@/lib/connections";
import { createTable } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";

export function CreateCollectionView() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!connection || !database || !name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await createTable(
        connection.kind,
        effectiveConnectionString(connection),
        {
          schema: database,
          name: name.trim(),
          columns: [],
          if_not_exists: false,
        },
        database,
      );
      await queryClient.invalidateQueries({ queryKey: ["tables", connection.id, database] });
      toast.success(`Collection „${name.trim()}“ erstellt.`);
      await navigate({
        to: "/tables/$schema/$table",
        params: { schema: database, table: name.trim() },
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <form
        className="mx-auto flex max-w-xl flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <h1 className="text-lg font-medium">Collection erstellen</h1>
        <p className="break-all text-sm text-muted-foreground">
          Datenbank: {database ?? "Bitte zuerst eine Datenbank auswählen."}
        </p>
        <div className="space-y-2">
          <Label htmlFor="collection-name">Collection-Name</Label>
          <Input
            id="collection-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="meine_collection"
            disabled={saving}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Felder entstehen mit den eingefügten Dokumenten. MongoDB vergibt automatisch eine _id,
          wenn keine angegeben wird.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={saving || !database || !name.trim()}>
            {saving ? "Wird erstellt…" : "Collection erstellen"}
          </Button>
          <Button type="button" variant="outline" onClick={() => void navigate({ to: "/" })}>
            Abbrechen
          </Button>
        </div>
      </form>
    </div>
  );
}
