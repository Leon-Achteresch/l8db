import { useQueryClient } from "@tanstack/react-query";
import { ListIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import { SPRING_LAYOUT } from "@/lib/ease";
import { useEnumsQuery } from "@/lib/queries";
import { quoteIdent } from "@/lib/sql-filter";
import { effectiveConnectionString } from "@/lib/ssh";

function CreateEnumDialog({
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

export function EnumsView() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: enums, isLoading } = useEnumsQuery();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["enums"] });
  };

  const handleDrop = async (schema: string, name: string) => {
    if (!connection) return;
    if (
      !window.confirm(
        `Enum-Typ "${schema}.${name}" wirklich löschen? Genutzte Spalten verhindern das Löschen.`,
      )
    )
      return;
    try {
      await executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
        `DROP TYPE ${quoteIdent(schema)}.${quoteIdent(name)}`,
        database ?? undefined,
      );
      toast.success(`Enum "${name}" gelöscht.`);
      refresh();
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    }
  };

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  return (
    <main className="mx-auto flex h-full w-full max-w-6xl min-h-0 flex-col gap-4 p-6">
      <header className="flex shrink-0 items-center gap-2">
        <ListIcon className="size-5 text-primary" />
        <h1 className="text-xl font-bold tracking-tight">Enum-Typen</h1>
        <Button
          size="sm"
          className="ml-auto h-8 gap-1.5 text-xs"
          onClick={() => setDialogOpen(true)}
        >
          <PlusIcon className="size-3.5" />
          Neuer Enum
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Lade Enums…</p>
        ) : (enums?.length ?? 0) === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Keine Enum-Typen gefunden.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {enums!.map((entry) => (
              <motion.div
                key={`${entry.schema}.${entry.name}`}
                layout
                transition={{ layout: SPRING_LAYOUT }}
                className="rounded-lg border p-4"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-medium">
                    {entry.schema}.{entry.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto size-7 hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => void handleDrop(entry.schema, entry.name)}
                    title={`Enum "${entry.name}" löschen`}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {entry.values.map((value) => (
                    <Badge
                      key={value}
                      variant="secondary"
                      className="px-1.5 py-0 font-mono text-[11px]"
                    >
                      {value}
                    </Badge>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <CreateEnumDialog open={dialogOpen} onOpenChange={setDialogOpen} onSuccess={refresh} />
    </main>
  );
}
