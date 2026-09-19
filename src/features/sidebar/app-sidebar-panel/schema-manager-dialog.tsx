import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useActiveConnection } from "@/lib/connections";
import { createSchema, dropSchema } from "@/lib/db";
import { useActiveDatabase, useActiveSchema, useDbSelectionStore } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";

export function SchemaManagerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const activeConnection = useActiveConnection();
  const activeDatabase = useActiveDatabase();
  const activeSchema = useActiveSchema();
  const setSchema = useDbSelectionStore((state) => state.setSchema);
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [cascade, setCascade] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshSchemas = () => {
    void queryClient.invalidateQueries({ queryKey: ["schemas"] });
  };

  const handleCreate = async () => {
    if (!activeConnection || !name.trim()) return;
    setBusy(true);
    try {
      await createSchema(
        activeConnection.kind,
        effectiveConnectionString(activeConnection),
        name.trim(),
        activeDatabase ?? undefined,
      );
      toast.success(`Schema "${name.trim()}" erstellt.`);
      setName("");
      refreshSchemas();
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDrop = async () => {
    if (!activeConnection || !activeSchema) return;
    if (
      !window.confirm(
        `Schema "${activeSchema}" wirklich löschen${cascade ? " (CASCADE – alle enthaltenen Objekte gehen verloren)" : ""}?`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await dropSchema(
        activeConnection.kind,
        effectiveConnectionString(activeConnection),
        activeSchema,
        cascade,
        activeDatabase ?? undefined,
      );
      toast.success(`Schema "${activeSchema}" gelöscht.`);
      setSchema(activeConnection.id, "public");
      setCascade(false);
      refreshSchemas();
      onOpenChange(false);
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Schemas verwalten</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Neues Schema</Label>
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 flex-1 text-xs font-mono"
                placeholder="z. B. analytics"
              />
              <Button
                size="sm"
                className="h-8"
                onClick={handleCreate}
                disabled={busy || !name.trim()}
              >
                Erstellen
              </Button>
            </div>
          </div>
          <div className="space-y-2 rounded-lg border border-destructive/20 p-3">
            <p className="text-xs">
              Aktives Schema: <span className="font-mono font-medium">{activeSchema ?? "—"}</span>
            </p>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={cascade} onCheckedChange={setCascade} />
              CASCADE (alle Objekte im Schema mit löschen)
            </label>
            <Button
              size="sm"
              variant="destructive"
              className="h-8 w-full"
              onClick={handleDrop}
              disabled={busy || !activeSchema}
            >
              Aktives Schema löschen
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
