import { ChevronRightIcon, DatabaseIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ConstraintEditorDialog } from "@/features/constraints/constraint-editor-dialog";
import { CreateTableColumnRow } from "@/features/tables/create-table-column-row";
import { CreateTableConstraints } from "@/features/tables/create-table-constraints";
import { CreateTableSqlPreview } from "@/features/tables/create-table-sql-preview";
import { CreateTableTemplatePopover } from "@/features/tables/create-table-template-popover";
import { splitType } from "@/features/tables/create-table-view/columns";
import { useCreateTable } from "@/features/tables/create-table-view/use-create-table";
import { useActiveDatabase } from "@/lib/db-selection";
import { useTableTabs } from "@/lib/table-tabs";

export function CreateTableView() {
  const database = useActiveDatabase();
  const openQueryTabWithSql = useTableTabs((state) => state.openQueryTabWithSql);
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

  const hasPrimaryKeyColumn = columns.some((c) => c.is_primary_key);
  const foreignKeyColumns = new Set(
    constraints.flatMap((c) => (c.kind === "foreign_key" ? c.columns : [])),
  );
  const typeChoices = [
    ...new Map(typeOptions.map((t) => [splitType(t).base, splitType(t)])).values(),
  ];
  const previewMessage =
    ddlError ??
    (incomplete ? "Tabellenname und alle Spaltennamen fehlen noch." : "Vorschau wird geladen…");

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b px-3">
        <DatabaseIcon className="size-3.5 shrink-0 text-muted-foreground" />
        {database && (
          <>
            <span className="text-xs text-muted-foreground">{database}</span>
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
          </>
        )}
        <Input
          value={schema}
          onChange={(e) => setSchema(e.target.value)}
          placeholder="public"
          aria-label="Schema"
          className="h-7 w-auto min-w-10 border-transparent bg-transparent px-1.5 text-xs text-muted-foreground shadow-none [field-sizing:content] hover:border-input focus-visible:text-foreground dark:bg-transparent"
        />
        <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
        <Input
          autoFocus
          value={tableName}
          onChange={(e) => setTableName(e.target.value)}
          placeholder="tabellenname"
          aria-label="Tabellenname"
          className="h-7 w-auto min-w-44 max-w-96 font-mono text-sm [field-sizing:content]"
        />
        <div className="ml-auto flex items-center gap-1">
          <CreateTableTemplatePopover
            tables={templateTables}
            value={templateTable}
            loading={loadingTemplate}
            notes={templateNotes}
            onApply={(table) => {
              setTemplateTable(table);
              void applyTemplate(table);
            }}
          />
          <div className="flex items-center gap-1.5 px-2">
            <Checkbox
              id="if-not-exists"
              checked={ifNotExists}
              onCheckedChange={(v) => setIfNotExists(Boolean(v))}
            />
            <Label
              htmlFor="if-not-exists"
              className="font-mono text-xs font-normal whitespace-nowrap"
            >
              IF NOT EXISTS
            </Label>
          </div>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => void navigate({ to: "/" })}
          >
            Abbrechen
          </Button>
          <Button size="sm" className="h-7" disabled={saving} onClick={() => void handleCreate()}>
            {saving ? "Wird erstellt…" : "Tabelle erstellen"}
          </Button>
        </div>
      </div>

      {constraintDialog ? (
        <div className="min-h-0 flex-1">
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
              constraintDialog.kind
                ? [constraintDialog.kind]
                : hasPrimaryKeyColumn
                  ? ["foreign_key", "check", "unique"]
                  : ["foreign_key", "check", "unique", "primary_key"]
            }
            isNewTable
            submitLabel={constraintDialog.index === null ? "Hinzufügen" : "Übernehmen"}
            onSubmit={saveConstraint}
          />
        </div>
      ) : (
        <>
          <div className="min-h-32 flex-1 overflow-auto">
            <table className="w-full table-fixed text-xs">
              <colgroup>
                <col className="w-[24%]" />
                <col className="w-[18%]" />
                <col className="w-20" />
                <col className="w-20" />
                <col />
                <col className="w-12" />
                <col className="w-16" />
                <col className="w-10" />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-background text-left text-muted-foreground">
                <tr className="h-8 border-b">
                  <th className="pl-8 font-medium">Name</th>
                  <th className="px-2 font-medium">Typ</th>
                  <th className="px-2 text-right font-medium">Länge</th>
                  <th className="text-center font-medium">Nullable</th>
                  <th className="px-2 font-medium">Default</th>
                  <th className="text-center font-medium">PK</th>
                  <th className="text-center font-medium">Unique</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {columns.map((col) => (
                  <CreateTableColumnRow
                    key={col.id}
                    column={col}
                    typeOptions={typeChoices}
                    foreignKey={foreignKeyColumns.has(col.name)}
                    removable={columns.length > 1}
                    onChange={(patch) => updateColumn(col.id, patch)}
                    onRemove={() => removeColumn(col.id)}
                  />
                ))}
              </tbody>
            </table>
            <button
              type="button"
              className="flex h-9 w-full items-center gap-2 pl-3 text-xs text-muted-foreground hover:bg-muted/30 hover:text-foreground"
              onClick={addColumn}
            >
              <PlusIcon className="size-3.5" />
              Spalte hinzufügen
            </button>
          </div>

          <CreateTableConstraints
            supported={constraintsSupported}
            constraints={constraints}
            columnNames={columns.map((c) => c.name)}
            hasPrimaryKeyColumn={hasPrimaryKeyColumn}
            primaryKeyName={primaryKeyName}
            primaryKeyPlaceholder={`pk_${tableName.trim() || "tabelle"}`}
            templateNotes={templateNotes}
            onPrimaryKeyNameChange={setPrimaryKeyName}
            onAdd={(kind) => openConstraintDialog(null, kind)}
            onEdit={(index) => openConstraintDialog(index)}
            onRemove={removeConstraint}
          />

          <CreateTableSqlPreview
            ddl={ddl}
            message={previewMessage}
            error={ddlError !== null}
            onCopy={() => void copyDdl()}
            onOpenInEditor={() => {
              const id = openQueryTabWithSql(ddl, `Neue Tabelle: ${tableName.trim() || "tabelle"}`);
              void navigate({ to: "/query/$id", params: { id } });
            }}
          />
        </>
      )}
    </div>
  );
}
