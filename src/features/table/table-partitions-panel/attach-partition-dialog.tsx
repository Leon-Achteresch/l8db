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
import { attachPartition } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";

export function AttachPartitionDialog({
  parentSchema,
  parentTable,
  open,
  onOpenChange,
  onSuccess,
}: {
  parentSchema: string;
  parentTable: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const [saving, setSaving] = useState(false);
  const [childSchema, setChildSchema] = useState(parentSchema);
  const [childTable, setChildTable] = useState("");
  const [bound, setBound] = useState("");

  const handleSave = async () => {
    if (!connection || !childTable.trim() || !bound.trim()) return;
    setSaving(true);
    try {
      await attachPartition(
        connection.kind,
        effectiveConnectionString(connection),
        parentSchema,
        parentTable,
        childSchema.trim() || parentSchema,
        childTable.trim(),
        bound.trim(),
        database ?? undefined,
      );
      toast.success(`Partition "${childTable.trim()}" angehängt.`);
      onSuccess();
      onOpenChange(false);
      setChildTable("");
      setBound("");
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
          <DialogTitle className="text-sm">
            Partition an {parentSchema}.{parentTable} anhängen
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Schema der Partition</Label>
              <Input
                value={childSchema}
                onChange={(e) => setChildSchema(e.target.value)}
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tabelle der Partition</Label>
              <Input
                value={childTable}
                onChange={(e) => setChildTable(e.target.value)}
                className="h-8 text-xs font-mono"
                placeholder="z. B. messwerte_2024"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Bindung (FOR VALUES …)</Label>
            <Input
              value={bound}
              onChange={(e) => setBound(e.target.value)}
              className="h-8 text-xs font-mono"
              placeholder="z. B. FOR VALUES FROM ('2024-01-01') TO ('2025-01-01')"
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
            disabled={saving || !childTable.trim() || !bound.trim()}
          >
            {saving ? "Anhängen…" : "Anhängen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
