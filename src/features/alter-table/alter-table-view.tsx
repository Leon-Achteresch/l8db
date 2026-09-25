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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { AddColumnRow } from "@/features/alter-table/alter-table-view/add-column-row";
import { DataTypeCombobox } from "@/features/alter-table/alter-table-view/data-type-combobox";
import { defaultDataType } from "@/features/alter-table/alter-table-view/data-types";
import { useAlterTable } from "@/features/alter-table/alter-table-view/use-alter-table";
import { TableConstraintsEditor } from "@/features/constraints/table-constraints-editor";
import { ObjectAdminMenu } from "@/features/object-admin/object-admin-menu";
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
    saving,
    handleStartEdit,
    handleCancelEdit,
    handleSaveEdit,
    handleAddColumn,
    handleDropColumn,
  } = useAlterTable(schema, table);
  const capabilities = useActiveCapabilities();

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
              Die Spalte und alle abhängigen Constraints werden unwiderruflich gelöscht (DROP COLUMN
              CASCADE).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleDropColumn} disabled={saving}>
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
                      value={editForm.new_name ?? col.name}
                      onChange={(e) => setEditForm((f) => ({ ...f, new_name: e.target.value }))}
                      className="h-7 text-xs"
                      autoFocus
                    />
                  </div>
                  <div className="bg-background px-3 py-1.5">
                    <DataTypeCombobox
                      value={editForm.data_type ?? col.data_type}
                      onChange={(v) => setEditForm((f) => ({ ...f, data_type: v }))}
                      kind={connection.kind}
                    />
                  </div>
                  <div className="flex items-center bg-background px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setEditForm((f) => ({ ...f, set_not_null: !(f.set_not_null ?? false) }))
                      }
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {editForm.set_not_null ? "NO" : "YES"}
                    </button>
                  </div>
                  <div className="bg-background px-3 py-1.5">
                    <Input
                      value={editForm.new_default ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, new_default: e.target.value }))}
                      placeholder="DEFAULT"
                      className="h-7 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-1 bg-background px-3 py-1.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={handleSaveEdit}
                      disabled={saving}
                    >
                      <SaveIcon className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={handleCancelEdit}
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  </div>
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
                    {col.data_type}
                    {col.character_maximum_length !== null && `(${col.character_maximum_length})`}
                  </div>
                  <div className="flex items-center bg-background px-4 py-2 text-xs text-muted-foreground">
                    {col.is_nullable ? "YES" : "NO"}
                  </div>
                  <div className="flex items-center bg-background px-4 py-2 font-mono text-xs text-muted-foreground">
                    <span className="truncate">{col.column_default ?? ""}</span>
                  </div>
                  <div className="flex items-center gap-1 bg-background px-3 py-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={() => handleStartEdit(col)}
                    >
                      <PencilIcon className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-destructive hover:text-destructive"
                      onClick={() => setDropTarget(col.name)}
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
              data_type:
                col.character_maximum_length !== null && !col.data_type.includes("(")
                  ? `${col.data_type}(${col.character_maximum_length})`
                  : col.data_type,
              is_primary_key: col.is_primary_key,
            }))}
          />
        )}
      </div>
    </div>
  );
}
