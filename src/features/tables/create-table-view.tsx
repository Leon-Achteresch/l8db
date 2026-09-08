import { useNavigate } from "@tanstack/react-router";
import { CopyIcon, PlusIcon, TableIcon, Trash2Icon } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { copyText } from "@/lib/clipboard";
import { useActiveConnection } from "@/lib/connections";
import {
  type ColumnDefinition,
  type CreateTableRequest,
  createTable,
  getTableRls,
  listConstraints,
  listForeignKeys,
  listTableColumnsDetailed,
  listTables,
  listTriggers,
  previewCreateTableDdl,
} from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import { SPRING_LAYOUT } from "@/lib/ease";
import { effectiveConnectionString } from "@/lib/ssh";

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

type FormColumn = ColumnDefinition & { id: number };

function nextId() {
  return Date.now() + Math.random();
}

function templateType(dataType: string, maxLength: number | null): string {
  if (maxLength === null || dataType.includes("(")) return dataType;
  return `${dataType}(${maxLength})`;
}

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
    {
      ...emptyColumn(),
      name: "id",
      data_type: "bigserial",
      is_nullable: false,
      is_primary_key: true,
    },
    {
      ...emptyColumn(),
      name: "created_at",
      data_type: "timestamptz",
      is_nullable: false,
      default_value: "now()",
    },
  ]);
  const [saving, setSaving] = useState(false);
  const capabilities = useActiveCapabilities();
  const [ddl, setDdl] = useState("");
  const [ddlError, setDdlError] = useState<string | null>(null);
  const [templateTables, setTemplateTables] = useState<string[]>([]);
  const [templateTable, setTemplateTable] = useState("");
  const [templateNotes, setTemplateNotes] = useState<string[]>([]);
  const [loadingTemplate, setLoadingTemplate] = useState(false);

  const incomplete = !tableName.trim() || columns.some((c) => !c.name.trim());

  const request = useMemo<CreateTableRequest>(
    () => ({
      schema: schema.trim() || "public",
      name: tableName.trim(),
      columns: columns.map(({ id: _id, ...rest }) => rest),
      if_not_exists: ifNotExists,
    }),
    [schema, tableName, columns, ifNotExists],
  );

  const connectionString = connection ? effectiveConnectionString(connection) : null;
  const kind = connection?.kind;

  useEffect(() => {
    if (!kind || !connectionString || incomplete) {
      setDdl("");
      setDdlError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      previewCreateTableDdl(kind, connectionString, request, database ?? undefined)
        .then((sql) => {
          if (cancelled) return;
          setDdl(sql);
          setDdlError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setDdl("");
          setDdlError(typeof err === "string" ? err : String(err));
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [kind, connectionString, database, request, incomplete]);

  useEffect(() => {
    if (!kind || !connectionString || !capabilities.ddl) {
      setTemplateTables([]);
      return;
    }
    let cancelled = false;
    listTables(kind, connectionString, database ?? undefined, schema.trim() || undefined)
      .then((tables) => {
        if (!cancelled) setTemplateTables(tables.map((t) => t.name));
      })
      .catch(() => {
        if (!cancelled) setTemplateTables([]);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, connectionString, database, schema, capabilities.ddl]);

  const applyTemplate = async (source: string) => {
    if (!kind || !connectionString) return;
    const sourceSchema = schema.trim() || "public";
    setLoadingTemplate(true);
    try {
      const detailed = await listTableColumnsDetailed(
        kind,
        connectionString,
        sourceSchema,
        source,
        database ?? undefined,
      );
      if (detailed.length === 0) {
        toast.error(`Tabelle "${source}" hat keine übernehmbaren Spalten.`);
        return;
      }
      const constraints = capabilities.constraints
        ? await listConstraints(
            kind,
            connectionString,
            sourceSchema,
            source,
            database ?? undefined,
          ).catch(() => [])
        : [];
      const uniqueSingle = new Set(
        constraints
          .filter(
            (c) => c.constraint_type.toUpperCase().includes("UNIQUE") && c.columns.length === 1,
          )
          .map((c) => c.columns[0]),
      );
      const notes: string[] = ["Zeilen und Tabellendaten werden nicht kopiert."];
      const droppedDefaults: string[] = [];

      const mapped: FormColumn[] = [...detailed]
        .sort((a, b) => a.ordinal_position - b.ordinal_position)
        .map((col) => {
          const rawDefault = col.column_default;
          const sequenceBound = Boolean(rawDefault && /nextval\s*\(/i.test(rawDefault));
          if (sequenceBound && rawDefault) droppedDefaults.push(`${col.name} (${rawDefault})`);
          return {
            id: nextId(),
            name: col.name,
            data_type: templateType(col.data_type, col.character_maximum_length),
            is_nullable: col.is_nullable,
            default_value: sequenceBound ? null : (rawDefault ?? null),
            is_primary_key: col.is_primary_key,
            is_unique: !col.is_primary_key && uniqueSingle.has(col.name),
          };
        });

      if (droppedDefaults.length > 0) {
        notes.push(
          `An die Quelltabelle gebundene Sequenz-Defaults nicht übernommen: ${droppedDefaults.join(", ")}.`,
        );
      }

      const otherConstraints = constraints.filter((c) => {
        const type = c.constraint_type.toUpperCase();
        if (type.includes("PRIMARY")) return false;
        if (type.includes("UNIQUE") && c.columns.length === 1) return false;
        return true;
      });
      if (otherConstraints.length > 0) {
        notes.push(
          `Constraints nicht übernommen: ${otherConstraints.map((c) => `${c.name} (${c.constraint_type})`).join(", ")}.`,
        );
      }

      if (capabilities.foreign_keys) {
        const fks = await listForeignKeys(
          kind,
          connectionString,
          sourceSchema,
          source,
          database ?? undefined,
        ).catch(() => []);
        if (fks.length > 0) {
          notes.push(
            `Fremdschlüssel nicht übernommen: ${[...new Set(fks.map((f) => f.constraint_name))].join(", ")}.`,
          );
        }
      }

      if (capabilities.triggers) {
        const triggers = await listTriggers(
          kind,
          connectionString,
          sourceSchema,
          source,
          database ?? undefined,
        ).catch(() => []);
        if (triggers.length > 0) {
          notes.push(
            `Trigger nicht übernommen: ${triggers.map((t) => t.trigger_name).join(", ")}.`,
          );
        }
      }

      if (capabilities.rls) {
        const rls = await getTableRls(
          kind,
          connectionString,
          sourceSchema,
          source,
          database ?? undefined,
        ).catch(() => null);
        if (rls?.rls_enabled) {
          notes.push(
            `RLS und ${rls.policies.length} Policy/Policies der Quelltabelle werden nicht übernommen.`,
          );
        }
      }

      notes.push("Indizes, Kommentare und Partitionierung werden nicht übernommen.");

      setColumns(mapped);
      setTableName("");
      setTemplateNotes(notes);
      toast.success(`Spalten aus "${sourceSchema}.${source}" übernommen. Neuen Namen vergeben.`);
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setLoadingTemplate(false);
    }
  };

  const copyDdl = async () => {
    if (!ddl) return;
    try {
      await copyText(ddl);
      toast.success("SQL kopiert.");
    } catch {
      toast.error("SQL konnte nicht kopiert werden.");
    }
  };

  const addColumn = () => setColumns((prev) => [...prev, emptyColumn()]);

  const removeColumn = (id: number) => setColumns((prev) => prev.filter((c) => c.id !== id));

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
        request,
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

          <div className="space-y-1.5">
            <Label className="text-xs">Spalten aus bestehender Tabelle übernehmen</Label>
            <Select
              value={templateTable}
              onValueChange={(v) => {
                setTemplateTable(v);
                void applyTemplate(v);
              }}
              disabled={loadingTemplate || templateTables.length === 0}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Vorlagentabelle wählen…" />
              </SelectTrigger>
              <SelectContent>
                {templateTables.map((t) => (
                  <SelectItem key={t} value={t} className="font-mono text-xs">
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {templateNotes.length > 0 && (
              <ul className="list-disc space-y-0.5 rounded-md border border-dashed bg-muted/30 px-5 py-2 text-[11px] text-muted-foreground">
                {templateNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
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
                <motion.div
                  key={col.id}
                  layout
                  transition={{ layout: SPRING_LAYOUT }}
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
                      onCheckedChange={(v) => updateColumn(col.id, { is_nullable: Boolean(v) })}
                    />
                  </div>
                  <div className="flex justify-center">
                    <Checkbox
                      checked={col.is_primary_key}
                      onCheckedChange={(v) => updateColumn(col.id, { is_primary_key: Boolean(v) })}
                    />
                  </div>
                  <div className="flex justify-center">
                    <Checkbox
                      checked={col.is_unique}
                      disabled={col.is_primary_key}
                      onCheckedChange={(v) => updateColumn(col.id, { is_unique: Boolean(v) })}
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
                </motion.div>
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

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">SQL-Vorschau</span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={!ddl}
                onClick={() => void copyDdl()}
              >
                <CopyIcon className="size-3" />
                Kopieren
              </Button>
            </div>
            {ddl ? (
              <Textarea
                readOnly
                value={ddl}
                spellCheck={false}
                rows={Math.min(20, ddl.split("\n").length + 1)}
                className="resize-none bg-muted/30 font-mono text-xs"
              />
            ) : (
              <p className="rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground">
                {ddlError ??
                  (incomplete
                    ? "Tabellenname und alle Spaltennamen angeben, um die Vorschau zu sehen."
                    : "Vorschau wird geladen…")}
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <Button size="sm" disabled={saving} onClick={() => void handleCreate()}>
              {saving ? "Wird erstellt…" : "Tabelle erstellen"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void navigate({ to: "/" })}>
              Abbrechen
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
