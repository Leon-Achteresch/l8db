import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActiveConnection } from "@/lib/connections";
import { executeQuery } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { quoteIdent } from "@/lib/sql-filter";
import { effectiveConnectionString } from "@/lib/ssh";

export function CreateEnumDialog({
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
  const [schema, setSchema] = useState("public");
  const [name, setName] = useState("");
  const [values, setValues] = useState("");

  const handleSave = async () => {
    if (!connection || !name.trim()) return;
    const labels = values
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (labels.length === 0) return;
    setSaving(true);
    try {
      const escaped = labels.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
      await executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
        `CREATE TYPE ${quoteIdent(schema.trim() || "public")}.${quoteIdent(name.trim())} AS ENUM (${escaped})`,
        database ?? undefined,
      );
      toast.success(`Enum "${name.trim()}" erstellt.`);
      onSuccess();
      onOpenChange(false);
      setName("");
      setValues("");
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Werte (kommagetrennt, Reihenfolge = Sortierung)</Label>
            <Input
              value={values}
              onChange={(e) => setValues(e.target.value)}
              className="h-8 text-xs font-mono"
              placeholder="z. B. gut, ok, schlecht"
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
            disabled={saving || !name.trim() || !values.trim()}
          >
            {saving ? "Erstellen…" : "Erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
