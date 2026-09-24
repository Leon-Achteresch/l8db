import { CopyIcon, PlusIcon, TableIcon, Trash2Icon } from "lucide-react";
import { motion } from "motion/react";
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
import { ConstraintDraftList } from "@/features/constraints/constraint-draft-list";
import { ConstraintEditorDialog } from "@/features/constraints/constraint-editor-dialog";
import { useCreateTable } from "@/features/tables/create-table-view/use-create-table";
import { SPRING_LAYOUT } from "@/lib/ease";

export function CreateTableView() {
  const {
    connection,
    navigate,
    tableName,
    setTableName,
    schema,
    setSchema,
    ifNotExists,
    setIfNotExists,
    columns,
    saving,
    ddl,
    ddlError,
    templateTables,
    templateTable,
    setTemplateTable,
    templateNotes,
    loadingTemplate,
    incomplete,
    typeOptions,
    applyTemplate,
    copyDdl,
    addColumn,
    removeColumn,
    updateColumn,
    handleCreate,
    constraints,
    constraintsSupported,
    primaryKeyName,
    setPrimaryKeyName,
    constraintDialog,
    openConstraintDialog,
    closeConstraintDialog,
    saveConstraint,
    removeConstraint,
  } = useCreateTable();

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
              <SelectContent searchable>
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
                      {typeOptions.map((t) => (
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

            <div className="flex flex-wrap items-center gap-1">
              {columns
                .filter((c) => c.is_primary_key)
                .map((c) => (
                  <Badge key={c.id} variant="outline" className="text-[10px]">
                    PK: {c.name}
                  </Badge>
                ))}
              {constraintsSupported && columns.some((c) => c.is_primary_key) && (
                <Input
                  value={primaryKeyName}
                  onChange={(e) => setPrimaryKeyName(e.target.value)}
                  placeholder={`pk_${tableName.trim() || "tabelle"}`}
                  aria-label="Name des Primärschlüssels"
                  className="ml-auto h-7 w-48 font-mono text-xs"
                />
              )}
            </div>
          </div>

          {constraintsSupported && connection && (
            <ConstraintDraftList
              constraints={constraints}
              columnNames={columns.map((c) => c.name)}
              onAdd={() => openConstraintDialog(null)}
              onEdit={openConstraintDialog}
              onRemove={removeConstraint}
            />
          )}

          {constraintDialog && (
            <ConstraintEditorDialog
              key={constraintDialog.key}
              open
              onOpenChange={(open) => {
                if (!open) closeConstraintDialog();
              }}
              kind={connection.kind}
              schema={schema.trim()}
              table={tableName.trim()}
              columns={columns
                .filter((c) => c.name.trim())
                .map((c) => ({ name: c.name, data_type: c.data_type }))}
              initial={constraintDialog.index === null ? null : constraints[constraintDialog.index]}
              allowedKinds={
                columns.some((c) => c.is_primary_key)
                  ? ["foreign_key", "check", "unique"]
                  : ["foreign_key", "check", "unique", "primary_key"]
              }
              isNewTable
              submitLabel={constraintDialog.index === null ? "Hinzufügen" : "Übernehmen"}
              onSubmit={saveConstraint}
            />
          )}

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
