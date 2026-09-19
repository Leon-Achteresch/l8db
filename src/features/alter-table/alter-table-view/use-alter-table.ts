import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { defaultDataType } from "@/features/alter-table/alter-table-view/data-types";
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

  const [editingColumn, setEditingColumn] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<AlterColumnRequest>({
    old_name: "",
    drop_default: false,
  });
  const [addingColumn, setAddingColumn] = useState(false);
  const [addForm, setAddForm] = useState<AddColumnRequest>(() => ({
    name: "",
    data_type: defaultDataType(connection?.kind),
    is_nullable: true,
  }));
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["table-columns-detailed", connection?.id, database, schema, table],
    });
    await queryClient.invalidateQueries({ queryKey: ["columns"] });
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

      if (editForm.new_name && editForm.new_name !== original.name) {
        changes.new_name = editForm.new_name;
      }
      if (editForm.data_type && editForm.data_type !== original.data_type) {
        changes.data_type = editForm.data_type;
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
    if (!connection || !addForm.name.trim()) return;
    setSaving(true);
    try {
      await addColumn(
        connection.kind,
        effectiveConnectionString(connection),
        schema,
        table,
        addForm,
        database ?? undefined,
      );
      toast.success(`Spalte "${addForm.name}" hinzugefügt.`);
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
      );
      toast.success(`Spalte "${dropTarget}" gelöscht.`);
      setDropTarget(null);
      await invalidate();
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
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
    saving,
    handleStartEdit,
    handleCancelEdit,
    handleSaveEdit,
    handleAddColumn,
    handleDropColumn,
  };
}
