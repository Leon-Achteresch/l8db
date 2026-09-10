import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DdlPreviewDialog } from "@/features/ddl/ddl-preview-dialog";
import { useActiveConnection } from "@/lib/connections";
import {
  executeObjectDdl,
  type ObjectAdminType,
  type ObjectDdlRequest,
  previewObjectDdl,
} from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";

interface ObjectRenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schema: string;
  name: string;
  objectType: ObjectAdminType;
  onRenamed?: (newName: string) => void;
}

const LABELS: Record<ObjectAdminType, string> = {
  table: "Tabelle",
  view: "View",
  materialized_view: "Materialized View",
};

export function ObjectRenameDialog({
  open,
  onOpenChange,
  schema,
  name,
  objectType,
  onRenamed,
}: ObjectRenameDialogProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState(name);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (open) {
      setNewName(name);
    }
  }, [open, name]);

  const connectionString = connection ? effectiveConnectionString(connection) : null;
  const kind = connection?.kind;
  const trimmed = newName.trim();
  const isValid = trimmed.length > 0 && trimmed !== name && !trimmed.includes('"');

  const request: ObjectDdlRequest = {
    schema,
    name,
    object_type: objectType,
    action: "rename",
    cascade: false,
    new_name: trimmed,
  };

  const preview = useQuery({
    queryKey: ["object-ddl", connection?.id, database, schema, name, objectType, "rename", trimmed],
    enabled: open && isValid && Boolean(kind && connectionString),
    queryFn: () => previewObjectDdl(kind!, connectionString!, request, database ?? undefined),
  });

  const handleConfirm = async () => {
    if (!kind || !connectionString || !isValid) return;
    setIsPending(true);
    try {
      await executeObjectDdl(kind, connectionString, request, database ?? undefined);
      await queryClient.invalidateQueries({ queryKey: ["tables"] });
      await queryClient.invalidateQueries({ queryKey: ["views"] });
      await queryClient.invalidateQueries({ queryKey: ["columns"] });
      toast.success(`${LABELS[objectType]} ${schema}.${name} heißt jetzt ${trimmed}.`);
      onOpenChange(false);
      onRenamed?.(trimmed);
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <DdlPreviewDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${LABELS[objectType]} ${schema}.${name} umbenennen`}
      description="Der neue Name wird erst nach Bestätigung angewendet."
      ddl={isValid ? (preview.data ?? "") : ""}
      ddlError={
        !isValid
          ? trimmed.length === 0
            ? "Neuen Namen eingeben."
            : trimmed === name
              ? "Der neue Name entspricht dem bisherigen Namen."
              : "Der neue Name darf keine Anführungszeichen enthalten."
          : preview.isError
            ? String(preview.error)
            : null
      }
      isLoading={preview.isLoading}
      confirmLabel="Umbenennen"
      confirmDisabled={!isValid}
      isPending={isPending}
      onConfirm={() => void handleConfirm()}
    >
      <div className="space-y-1.5">
        <Label htmlFor="object-rename-name" className="text-xs">
          Neuer Name
        </Label>
        <Input
          id="object-rename-name"
          value={newName}
          autoComplete="off"
          onChange={(event) => setNewName(event.target.value)}
          placeholder={name}
        />
      </div>
    </DdlPreviewDialog>
  );
}
