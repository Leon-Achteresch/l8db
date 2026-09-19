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
import { Switch } from "@/components/ui/switch";
import { useActiveConnection } from "@/lib/connections";
import { type AlterSequenceRequest, alterSequence, type SequenceInfo } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";

export interface EditSequenceDialogProps {
  sequence: SequenceInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function EditSequenceDialog({
  sequence,
  open,
  onOpenChange,
  onSuccess,
}: EditSequenceDialogProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<AlterSequenceRequest>({
    increment_by: sequence.increment_by,
    min_value: sequence.min_value,
    max_value: sequence.max_value,
    cycle: sequence.cycle,
    restart_with: "",
  });

  const handleSave = async () => {
    if (!connection) return;
    setSaving(true);
    try {
      const changes: AlterSequenceRequest = {};
      if (form.increment_by !== sequence.increment_by) changes.increment_by = form.increment_by;
      if (form.min_value !== sequence.min_value) changes.min_value = form.min_value;
      if (form.max_value !== sequence.max_value) changes.max_value = form.max_value;
      if (form.cycle !== sequence.cycle) changes.cycle = form.cycle;
      if (form.restart_with && form.restart_with.trim() !== "")
        changes.restart_with = form.restart_with;

      await alterSequence(
        connection.kind,
        effectiveConnectionString(connection),
        sequence.schema,
        sequence.name,
        changes,
        database ?? undefined,
      );
      toast.success(`Sequenz "${sequence.name}" aktualisiert.`);
      onSuccess();
      onOpenChange(false);
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
          <DialogTitle className="font-mono text-sm">
            {sequence.schema}.{sequence.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Inkrement</Label>
              <Input
                value={form.increment_by ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, increment_by: e.target.value }))}
                className="h-8 text-xs font-mono"
                placeholder={sequence.increment_by}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Neu starten mit</Label>
              <Input
                value={form.restart_with ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, restart_with: e.target.value }))}
                className="h-8 text-xs font-mono"
                placeholder="optional"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Minimalwert</Label>
              <Input
                value={form.min_value ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, min_value: e.target.value }))}
                className="h-8 text-xs font-mono"
                placeholder={sequence.min_value}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Maximalwert</Label>
              <Input
                value={form.max_value ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, max_value: e.target.value }))}
                className="h-8 text-xs font-mono"
                placeholder={sequence.max_value}
              />
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <Switch
              id="cycle"
              checked={form.cycle ?? false}
              onCheckedChange={(v) => setForm((f) => ({ ...f, cycle: v }))}
            />
            <Label htmlFor="cycle" className="text-xs cursor-pointer">
              Zyklisch (CYCLE)
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Abbrechen
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Speichern…" : "Speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
