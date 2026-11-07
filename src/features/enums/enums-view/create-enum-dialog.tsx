import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { asWorkbenchTab } from "@/features/shell/as-workbench-tab";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/features/shell/workbench-dialog";
import { useActiveConnection } from "@/lib/connections";
import { executeQuery } from "@/lib/db";
import { useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import { createEnumSql, enumLabels } from "@/lib/enum-ddl";
import { pgIdentifierTooLong } from "@/lib/object-rename";
import { effectiveConnectionString } from "@/lib/ssh";

function CreateEnumDialogContent({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const [saving, setSaving] = useState(false);
  const activeSchema = useActiveSchema();
  const [schema, setSchema] = useState(activeSchema);
  const [name, setName] = useState("");
  const [values, setValues] = useState("");

  const labels = enumLabels(values);
  const tooLong = pgIdentifierTooLong(name.trim());

  const handleSave = async () => {
    if (!connection || !name.trim() || labels.length === 0 || tooLong) return;
    setSaving(true);
    try {
      await executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
        createEnumSql(schema.trim() || activeSchema, name.trim(), labels),
        database ?? undefined,
      );
      toast.success(`Enum "${name.trim()}" erstellt.`);
      onSuccess();
      onOpenChange(false);
      setName("");
      setValues("");
      setSchema(activeSchema);
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog busy={saving} open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Neuer Enum-Typ</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Schema</Label>
              <Input
                value={schema}
                onChange={(e) => setSchema(e.target.value)}
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 text-xs font-mono"
                placeholder="z. B. mood"
                aria-invalid={tooLong}
              />
              {tooLong && (
                <p className="text-[11px] text-destructive">
                  Höchstens 63 Bytes, PostgreSQL würde den Namen sonst kürzen.
                </p>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Werte (ein Wert pro Zeile, Reihenfolge = Sortierung)</Label>
            <Textarea
              value={values}
              onChange={(e) => setValues(e.target.value)}
              className="min-h-24 text-xs font-mono"
              placeholder={"gut\nok\nschlecht"}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Abbrechen
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !name.trim() || labels.length === 0 || tooLong}
          >
            {saving ? "Erstellen…" : "Erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const CreateEnumDialog = asWorkbenchTab(CreateEnumDialogContent, "Enum-Editor");
