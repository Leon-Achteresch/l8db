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
import { type CreatePublicationRequest, createPublication } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { useTablesQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";

export function CreatePublicationDialog({
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
  const { data: tables } = useTablesQuery();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [forAllTables, setForAllTables] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publishInsert, setPublishInsert] = useState(true);
  const [publishUpdate, setPublishUpdate] = useState(true);
  const [publishDelete, setPublishDelete] = useState(true);
  const [publishTruncate, setPublishTruncate] = useState(true);

  const toggleTable = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSave = async () => {
    if (!connection || !name.trim()) return;
    setSaving(true);
    try {
      const request: CreatePublicationRequest = {
        name: name.trim(),
        for_all_tables: forAllTables,
        tables: forAllTables
          ? []
          : [...selected].map((key) => {
              const [schema, table] = key.split(".", 2);
              return { schema, table };
            }),
        publish_insert: publishInsert,
        publish_update: publishUpdate,
        publish_delete: publishDelete,
        publish_truncate: publishTruncate,
      };
      await createPublication(
        connection.kind,
        effectiveConnectionString(connection),
        request,
        database ?? undefined,
      );
      toast.success(`Publikation "${name.trim()}" erstellt.`);
      onSuccess();
      onOpenChange(false);
      setName("");
      setSelected(new Set());
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Neue Publikation</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 text-xs font-mono"
              placeholder="z. B. app_pub"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Switch checked={forAllTables} onCheckedChange={setForAllTables} />
            Alle Tabellen (FOR ALL TABLES)
          </label>
          {!forAllTables && (
            <div className="space-y-1.5">
              <Label className="text-xs">Tabellen ({selected.size} gewählt)</Label>
              <div className="max-h-44 overflow-y-auto rounded-lg border p-2">
                {(tables ?? []).map((table) => {
                  const key = `${table.schema}.${table.name}`;
                  return (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/60"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(key)}
                        onChange={() => toggleTable(key)}
                        className="size-3.5 accent-primary"
                      />
                      <span className="font-mono">{key}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {(
              [
                ["INSERT", publishInsert, setPublishInsert],
                ["UPDATE", publishUpdate, setPublishUpdate],
                ["DELETE", publishDelete, setPublishDelete],
                ["TRUNCATE", publishTruncate, setPublishTruncate],
              ] as const
            ).map(([label, value, setValue]) => (
              <label key={label} className="flex cursor-pointer items-center gap-2 text-xs">
                <Switch checked={value} onCheckedChange={setValue} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Abbrechen
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !name.trim() || (!forAllTables && selected.size === 0)}
          >
            {saving ? "Erstellen…" : "Erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
