import { KeyRoundIcon, PencilIcon, PlusIcon, SaveIcon, TrashIcon, XIcon } from "lucide-react";
import { motion } from "motion/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { AddColumnRow } from "@/features/alter-table/alter-table-view/add-column-row";
import { DataTypeCombobox } from "@/features/alter-table/alter-table-view/data-type-combobox";
import {
  columnEditSupport,
  DEFAULT_EXPRESSION_HINT,
  defaultDataType,
  dropColumnDescription,
} from "@/features/alter-table/alter-table-view/data-types";
import { useAlterTable } from "@/features/alter-table/alter-table-view/use-alter-table";
import { TableConstraintsEditor } from "@/features/constraints/table-constraints-editor";
import { ObjectAdminMenu } from "@/features/object-admin/object-admin-menu";
import { columnTypeLabel } from "@/lib/column-type";
import { useActiveCapabilities } from "@/lib/db-selection";
import { SPRING_LAYOUT } from "@/lib/ease";

interface AlterTableViewProps {
  schema: string;
  table: string;
}

export function AlterTableView({ schema, table }: AlterTableViewProps) {
  const {
    connection,
    columns,
    isLoading,
    isError,
    error,
    editingColumn,
    editForm,
    setEditForm,
    addingColumn,
    setAddingColumn,
    addForm,
    setAddForm,
    dropTarget,
    setDropTarget,
    dropCascade,
    setDropCascade,
    dropError,
    saving,
    handleStartEdit,
    handleCancelEdit,
    handleSaveEdit,
    handleAddColumn,
    handleDropColumn,
  } = useAlterTable(schema, table);
  const capabilities = useActiveCapabilities();
  const support = columnEditSupport(connection?.kind);

  if (!connection) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Keine aktive Verbindung.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
        <Spinner />
        Lade Spalten…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center text-destructive">
        {String(error)}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">
            {schema}.{table}
          </h2>
          <Badge variant="outline" className="text-xs">
            {columns?.length ?? 0} Spalten
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <ObjectAdminMenu schema={schema} name={table} objectType="table" showAlter={false} />
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              setAddingColumn(true);
              setAddForm({
                name: "",
                data_type: defaultDataType(connection?.kind),
                is_nullable: true,
              });
            }}
            disabled={addingColumn}
          >
            <PlusIcon data-icon="inline-start" />
            Spalte hinzufügen
          </Button>
        </div>
      </div>

      <AlertDialog
        open={dropTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDropTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Spalte &quot;{dropTarget}&quot; löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {dropColumnDescription(connection.kind)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {support.dropCascade && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="drop-column-cascade"
                checked={dropCascade}
                onCheckedChange={(checked) => setDropCascade(checked === true)}
              />
              <Label htmlFor="drop-column-cascade" className="text-xs font-normal">
                CASCADE — abhängige Views, Constraints und Indizes mitlöschen
              </Label>
            </div>
          )}
          {dropError && (
            <p className="whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              {dropError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDropColumn();
              }}
              disabled={saving}
            >
              {saving ? <Spinner className="size-4" /> : null}
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex-1 overflow-auto">
        <div className="min-w-0">
          <div className="grid grid-cols-[1fr_1fr_80px_1fr_auto] gap-px border-b bg-muted text-xs font-medium text-muted-foreground">
            <div className="bg-background px-4 py-2">Name</div>
            <div className="bg-background px-4 py-2">Datentyp</div>
            <div className="bg-background px-4 py-2">Nullable</div>
            <div className="bg-background px-4 py-2">Default</div>
            <div className="bg-background px-4 py-2 text-right">Aktionen</div>
          </div>

          {addingColumn && (
            <AddColumnRow
              addForm={addForm}
              setAddForm={setAddForm}
              kind={connection.kind}
              saving={saving}
              onSave={handleAddColumn}
              onCancel={() => setAddingColumn(false)}
            />
          )}

          {columns?.map((col) => (
            <motion.div
              key={col.name}
              layout
              transition={{ layout: SPRING_LAYOUT }}
              className="group grid grid-cols-[1fr_1fr_80px_1fr_auto] gap-px border-b bg-muted text-sm"
            >
              {editingColumn === col.name ? (
                <>
                  <div className="bg-background px-3 py-1.5">
                    <Input
                      aria-label={`Name von ${col.name}`}
                      value={editForm.new_name ?? col.name}
                      onChange={(e) => setEditForm((f) => ({ ...f, new_name: e.target.value }))}
                      className="h-7 text-xs"
                      autoFocus
                    />
                  </div>
                  {support.renameOnly ? (
                    <div className="col-span-3 flex items-center bg-background px-4 py-1.5 text-xs text-muted-foreground">
                      <span className="mr-2 font-mono">
                        {columnTypeLabel(col.data_type, col.character_maximum_length)}
                      </span>
                      Diese Datenbank kann bestehende Spalten nur umbenennen.
                    </div>
                  ) : (
                    <>
                      <div className="bg-background px-3 py-1.5">
                        <DataTypeCombobox
                          value={editForm.data_type ?? col.data_type}
                          onChange={(v) => setEditForm((f) => ({ ...f, data_type: v }))}
                          kind={connection.kind}
                        />
                      </div>
                      <div className="flex items-center bg-background px-3 py-1.5">
                        <Switch
                          size="sm"
                          checked={!(editForm.set_not_null ?? false)}
                          onCheckedChange={(nullable) =>
                            setEditForm((f) => ({ ...f, set_not_null: !nullable }))
                          }
                          aria-label={`NULL-Werte in ${col.name} erlauben`}
                        />
                      </div>
                      <div className="bg-background px-3 py-1.5">
                        <Input
                          aria-label={`Standardwert von ${col.name}`}
                          title={DEFAULT_EXPRESSION_HINT}
                          value={editForm.new_default ?? ""}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, new_default: e.target.value }))
                          }
                          placeholder="SQL-Ausdruck, z. B. 'Text'"
                          className="h-7 font-mono text-xs"
                        />
                      </div>
                    </>
                  )}
                  <div className="flex items-center gap-1 bg-background px-3 py-1.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={handleSaveEdit}
                      disabled={saving}
                      aria-label="Speichern"
                    >
                      <SaveIcon className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={handleCancelEdit}
                      aria-label="Abbrechen"
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  </div>
                  {editForm.data_type !== undefined &&
                    editForm.data_type.trim() !== col.data_type && (
                      <div className="col-span-5 flex flex-wrap items-center gap-2 bg-background px-4 py-1.5 text-xs text-muted-foreground">
                        <span className="text-amber-600 dark:text-amber-500">
                          Typänderungen wandeln bestehende Werte um und können sie kürzen oder
                          fehlschlagen lassen.
                        </span>
                        {support.using && (
                          <Input
                            aria-label="USING-Ausdruck für die Typänderung"
                            value={editForm.using ?? ""}
                            onChange={(e) => setEditForm((f) => ({ ...f, using: e.target.value }))}
                            placeholder={`USING (optional), z. B. ${col.name}::${editForm.data_type.trim()}`}
                            className="h-7 max-w-md font-mono text-xs"
                          />
                        )}
                      </div>
                    )}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1.5 bg-background px-4 py-2">
                    {col.is_primary_key && (
                      <KeyRoundIcon className="size-3.5 shrink-0 text-amber-500" />
                    )}
                    <span className="truncate">{col.name}</span>
                  </div>
                  <div className="flex items-center bg-background px-4 py-2 font-mono text-xs text-muted-foreground">
                    {columnTypeLabel(col.data_type, col.character_maximum_length)}
                  </div>
                  <div className="flex items-center bg-background px-4 py-2 text-xs text-muted-foreground">
                    {col.is_nullable ? "YES" : "NO"}
                  </div>
                  <div className="flex items-center bg-background px-4 py-2 font-mono text-xs text-muted-foreground">
                    <span className="truncate">{col.column_default ?? ""}</span>
                  </div>
                  <div className="flex items-center gap-1 bg-background px-3 py-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={() => handleStartEdit(col)}
                      aria-label={`Spalte ${col.name} bearbeiten`}
                    >
                      <PencilIcon className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-destructive hover:text-destructive"
                      onClick={() => setDropTarget(col.name)}
                      aria-label={`Spalte ${col.name} löschen`}
                    >
                      <TrashIcon className="size-3.5" />
                    </Button>
                  </div>
                </>
              )}
            </motion.div>
          ))}
        </div>
        {capabilities.constraints && (
          <TableConstraintsEditor
            schema={schema}
            table={table}
            columns={(columns ?? []).map((col) => ({
              name: col.name,
              data_type: columnTypeLabel(col.data_type, col.character_maximum_length),
              is_primary_key: col.is_primary_key,
            }))}
          />
        )}
      </div>
    </div>
  );
}
