import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  defaultDataType,
  nullableLocked,
} from "@/features/alter-table/alter-table-view/data-types";
import { useActiveConnection } from "@/lib/connections";
import {
  type AddColumnRequest,
  type AlterColumnRequest,
  addColumn,
  alterColumn,
  type DetailedColumnInfo,
  dropColumn,
  listTableColumnsDetailed,
} from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";
import { tabStateKey, useTabState } from "@/lib/tab-state";

export function useAlterTable(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();

  const {
    data: columns,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["table-columns-detailed", connection?.id, database, schema, table],
    queryFn: () =>
      listTableColumnsDetailed(
        connection!.kind,
        effectiveConnectionString(connection!),
        schema,
        table,
        database ?? undefined,
      ),
    enabled: !!connection,
  });

  const scope = `alter-table:${connection?.id}:${database}:${schema}.${table}`;
  const [editingColumn, setEditingColumn] = useTabState<string | null>(
    tabStateKey(scope, "editingColumn"),
    null,
  );
  const [editForm, setEditForm] = useTabState<AlterColumnRequest>(tabStateKey(scope, "editForm"), {
    old_name: "",
    drop_default: false,
  });
  const [addingColumn, setAddingColumn] = useTabState(tabStateKey(scope, "addingColumn"), false);
  const [addForm, setAddForm] = useTabState<AddColumnRequest>(tabStateKey(scope, "addForm"), {
    name: "",
    data_type: defaultDataType(connection?.kind),
    is_nullable: true,
  });
  const [dropTarget, setDropTargetState] = useState<string | null>(null);
  const [dropCascade, setDropCascade] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setDropTarget = (target: string | null) => {
    setDropTargetState(target);
    setDropCascade(false);
    setDropError(null);
  };

  const invalidate = async () => {
    await Promise.all(
      [
        ["table-columns-detailed", connection?.id, database, schema, table],
        ["columns"],
        ["columns-detailed"],
        ["er-schema"],
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  };

  const handleStartEdit = (col: DetailedColumnInfo) => {
    setEditingColumn(col.name);
    setEditForm({
      old_name: col.name,
      new_name: col.name,
      data_type: col.data_type,
      set_not_null: !col.is_nullable,
      new_default: col.column_default ?? undefined,
      drop_default: false,
    });
  };

  const handleCancelEdit = () => {
    setEditingColumn(null);
  };

  const handleSaveEdit = async () => {
    if (!connection) return;
    setSaving(true);
    try {
      const original = columns?.find((c) => c.name === editForm.old_name);
      if (!original) return;

      const changes: AlterColumnRequest = {
        old_name: editForm.old_name,
        drop_default: false,
      };

      const newName = editForm.new_name?.trim();
      if (newName && newName !== original.name) {
        changes.new_name = newName;
      }
      const dataType = editForm.data_type?.trim();
      if (dataType && dataType !== original.data_type) {
        changes.data_type = dataType;
        const using = editForm.using?.trim();
        if (using) changes.using = using;
      }
      const wantNotNull = editForm.set_not_null ?? false;
      if (wantNotNull !== !original.is_nullable) {
        changes.set_not_null = wantNotNull;
      }

      const newDefault = editForm.new_default?.trim() ?? "";
      const oldDefault = original.column_default ?? "";
      if (newDefault !== oldDefault) {
        if (newDefault === "" && oldDefault !== "") {
          changes.drop_default = true;
        } else if (newDefault !== "") {
          changes.new_default = newDefault;
        }
      }

      await alterColumn(
        connection.kind,
        effectiveConnectionString(connection),
        schema,
        table,
        changes,
        database ?? undefined,
      );
      toast.success(`Spalte "${editForm.old_name}" aktualisiert.`);
      setEditingColumn(null);
      await invalidate();
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleAddColumn = async () => {
    const name = addForm.name.trim();
    if (!connection || !name) return;
    setSaving(true);
    try {
      await addColumn(
        connection.kind,
        effectiveConnectionString(connection),
        schema,
        table,
        {
          ...addForm,
          name,
          data_type: addForm.data_type.trim(),
          is_nullable: addForm.is_nullable && !nullableLocked(connection.kind, addForm.data_type),
        },
        database ?? undefined,
      );
      toast.success(`Spalte "${name}" hinzugefügt.`);
      setAddingColumn(false);
      setAddForm({ name: "", data_type: defaultDataType(connection?.kind), is_nullable: true });
      await invalidate();
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDropColumn = async () => {
    if (!connection || !dropTarget) return;
    setSaving(true);
    try {
      await dropColumn(
        connection.kind,
        effectiveConnectionString(connection),
        schema,
        table,
        dropTarget,
        database ?? undefined,
        dropCascade,
      );
      toast.success(`Spalte "${dropTarget}" gelöscht.`);
      setDropTarget(null);
      await invalidate();
    } catch (err) {
      setDropError(String(err));
    } finally {
      setSaving(false);
    }
  };
  return {
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
  };
}
