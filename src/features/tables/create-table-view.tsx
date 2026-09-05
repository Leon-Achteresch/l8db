import { useState } from "react";

import { useNavigate } from "@tanstack/react-router";
import { PlusIcon, TableIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveConnection } from "@/lib/connections";
import { effectiveConnectionString } from "@/lib/ssh";
import { ColumnDefinition, createTable } from "@/lib/db";
import { useActiveDatabase, useActiveSchema } from "@/lib/db-selection";

const COMMON_TYPES = [
  "bigint",
  "bigserial",
  "boolean",
  "bytea",
  "date",
  "double precision",
  "integer",
  "jsonb",
  "numeric",
  "real",
  "serial",
  "smallint",
  "text",
  "time",
  "timestamp",
  "timestamptz",
  "uuid",
  "varchar(255)",
];

function emptyColumn(): ColumnDefinition & { id: number } {
  return {
    id: Date.now() + Math.random(),
    name: "",
    data_type: "text",
    is_nullable: true,
    default_value: null,
    is_primary_key: false,
    is_unique: false,
  };
}

export function CreateTableView() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const activeSchema = useActiveSchema();
  const navigate = useNavigate();

  const [tableName, setTableName] = useState("");
  const [schema, setSchema] = useState(activeSchema ?? "public");
  const [ifNotExists, setIfNotExists] = useState(false);
  const [columns, setColumns] = useState<(ColumnDefinition & { id: number })[]>([
    { ...emptyColumn(), name: "id", data_type: "bigserial", is_nullable: false, is_primary_key: true },
    { ...emptyColumn(), name: "created_at", data_type: "timestamptz", is_nullable: false, default_value: "now()" },
  ]);
  const [saving, setSaving] = useState(false);

  const addColumn = () => setColumns((prev) => [...prev, emptyColumn()]);

  const removeColumn = (id: number) =>
    setColumns((prev) => prev.filter((c) => c.id !== id));

  const updateColumn = (id: number, patch: Partial<ColumnDefinition>) =>
    setColumns((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const handleCreate = async () => {
    if (!connection) return;
    if (!tableName.trim()) {
      toast.error("Tabellenname ist erforderlich.");
      return;
    }
    if (columns.some((c) => !c.name.trim())) {
      toast.error("Alle Spalten müssen einen Namen haben.");
      return;
    }
    setSaving(true);
    try {
      await createTable(
        connection.kind,
        effectiveConnectionString(connection),
        {
          schema: schema.trim() || "public",
          name: tableName.trim(),
          columns: columns.map(({ id: _id, ...rest }) => rest),
          if_not_exists: ifNotExists,
        },
        database ?? undefined,
      );
      toast.success(`Tabelle "${schema}.${tableName}" erstellt.`);
      void navigate({ to: "/" });
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setSaving(false);
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
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
        <TableIcon className="size-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Tabelle erstellen</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Schema</Label>
              <Input
                value={schema}
                onChange={(e) => setSchema(e.target.value)}
                placeholder="public"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tabellenname</Label>
              <Input
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                placeholder="meine_tabelle"
                className="h-8 font-mono text-sm"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="if-not-exists"
              checked={ifNotExists}
              onCheckedChange={(v) => setIfNotExists(Boolean(v))}
            />
            <Label htmlFor="if-not-exists" className="text-xs font-normal">
              IF NOT EXISTS
            </Label>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Spalten</span>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addColumn}>
                <PlusIcon className="size-3" />
                Spalte hinzufügen
              </Button>
            </div>

            <div className="rounded-md border">
              <div className="grid grid-cols-[1fr_1fr_auto_auto_auto_auto_auto] items-center gap-2 border-b bg-muted/50 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                <span>Name</span>
                <span>Typ</span>
                <span>Default</span>
                <span>Nullable</span>
                <span>PK</span>
                <span>Unique</span>
                <span />
              </div>
              {columns.map((col) => (
                <div
                  key={col.id}
                  className="grid grid-cols-[1fr_1fr_auto_auto_auto_auto_auto] items-center gap-2 border-b px-3 py-2 last:border-b-0"
                >
                  <Input
                    value={col.name}
                    onChange={(e) => updateColumn(col.id, { name: e.target.value })}
                    placeholder="spaltenname"
                    className="h-7 font-mono text-xs"
                  />
                  <Select
                    value={col.data_type}
                    onValueChange={(v) => updateColumn(col.id, { data_type: v })}
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COMMON_TYPES.map((t) => (
                        <SelectItem key={t} value={t} className="font-mono text-xs">
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={col.default_value ?? ""}
                    onChange={(e) =>
                      updateColumn(col.id, {
                        default_value: e.target.value || null,
                      })
                    }
                    placeholder="—"
                    className="h-7 w-24 font-mono text-xs"
                  />
                  <div className="flex justify-center">
                    <Checkbox
                      checked={col.is_nullable}
                      onCheckedChange={(v) =>
                        updateColumn(col.id, { is_nullable: Boolean(v) })
                      }
                    />
                  </div>
                  <div className="flex justify-center">
                    <Checkbox
                      checked={col.is_primary_key}
                      onCheckedChange={(v) =>
                        updateColumn(col.id, { is_primary_key: Boolean(v) })
                      }
                    />
                  </div>
                  <div className="flex justify-center">
                    <Checkbox
                      checked={col.is_unique}
                      disabled={col.is_primary_key}
                      onCheckedChange={(v) =>
                        updateColumn(col.id, { is_unique: Boolean(v) })
                      }
                    />
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 text-muted-foreground hover:text-destructive"
                    disabled={columns.length <= 1}
                    onClick={() => removeColumn(col.id)}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-1">
              {columns
                .filter((c) => c.is_primary_key)
                .map((c) => (
                  <Badge key={c.id} variant="outline" className="text-[10px]">
                    PK: {c.name}
                  </Badge>
                ))}
            </div>
          </div>

          <div className="flex gap-3">
            <Button size="sm" disabled={saving} onClick={() => void handleCreate()}>
              {saving ? "Wird erstellt…" : "Tabelle erstellen"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void navigate({ to: "/" })}
            >
              Abbrechen
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
