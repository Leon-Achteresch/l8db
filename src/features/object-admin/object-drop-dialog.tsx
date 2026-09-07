import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DdlPreviewDialog } from "@/features/ddl/ddl-preview-dialog";
import { useActiveConnection } from "@/lib/connections";
import {
  executeObjectDdl,
  objectAuditInfo,
  type ObjectAdminType,
  type ObjectDdlRequest,
  previewObjectDdl,
} from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";

interface ObjectDropDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schema: string;
  name: string;
  objectType: ObjectAdminType;
  onDropped?: () => void;
}

const LABELS: Record<ObjectAdminType, string> = {
  table: "Tabelle",
  view: "View",
  materialized_view: "Materialized View",
};

export function ObjectDropDialog({
  open,
  onOpenChange,
  schema,
  name,
  objectType,
  onDropped,
}: ObjectDropDialogProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const [cascade, setCascade] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (open) {
      setCascade(false);
      setConfirmName("");
    }
  }, [open]);

  const connectionString = connection ? effectiveConnectionString(connection) : null;
  const kind = connection?.kind;

  const request: ObjectDdlRequest = {
    schema,
    name,
    object_type: objectType,
    action: "drop",
    cascade,
    new_name: null,
  };

  const preview = useQuery({
    queryKey: ["object-ddl", connection?.id, database, schema, name, objectType, "drop", cascade],
    enabled: open && Boolean(kind && connectionString),
    queryFn: () => previewObjectDdl(kind!, connectionString!, request, database ?? undefined),
  });

  const audit = useQuery({
    queryKey: ["object-audit", connection?.id, database, schema, name, objectType],
    enabled: open && Boolean(kind && connectionString),
    queryFn: () =>
      objectAuditInfo(kind!, connectionString!, schema, name, objectType, database ?? undefined),
  });

  const dependents = audit.data?.dependents ?? [];

  const handleConfirm = async () => {
    if (!kind || !connectionString) return;
    setIsPending(true);
    try {
      await executeObjectDdl(kind, connectionString, request, database ?? undefined);
      await queryClient.invalidateQueries({ queryKey: ["tables"] });
      await queryClient.invalidateQueries({ queryKey: ["views"] });
      await queryClient.invalidateQueries({ queryKey: ["columns"] });
      toast.success(`${LABELS[objectType]} ${schema}.${name} wurde gelöscht.`);
      onOpenChange(false);
      onDropped?.();
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
      title={`${LABELS[objectType]} ${schema}.${name} löschen`}
      description="Das Objekt wird unwiderruflich entfernt. Zum Bestätigen den Objektnamen eingeben."
      ddl={preview.data ?? ""}
      ddlError={preview.isError ? String(preview.error) : null}
      isLoading={preview.isLoading}
      confirmLabel="Löschen"
      destructive
      confirmDisabled={confirmName.trim() !== name}
      isPending={isPending}
      onConfirm={() => void handleConfirm()}
    >
      <div className="space-y-3">
        <div className="rounded-md border p-3 text-xs">
          <p className="mb-1 font-medium">Abhängige Objekte</p>
          {audit.isLoading ? (
            <p className="text-muted-foreground">Wird geladen…</p>
          ) : audit.isError ? (
            <p className="text-muted-foreground">
              Abhängigkeiten konnten nicht ermittelt werden: {String(audit.error)}
            </p>
          ) : dependents.length === 0 ? (
            <p className="text-muted-foreground">Keine abhängigen Objekte gefunden.</p>
          ) : (
            <ul className="space-y-0.5 text-muted-foreground">
              {dependents.map((dep) => (
                <li key={`${dep.object_type}.${dep.schema}.${dep.name}`}>
                  {dep.schema}.{dep.name} ({dep.object_type})
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="object-drop-cascade"
            checked={cascade}
            onCheckedChange={(checked) => setCascade(checked === true)}
          />
          <Label htmlFor="object-drop-cascade" className="text-xs font-normal">
            CASCADE — abhängige Objekte mitlöschen
          </Label>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="object-drop-confirm" className="text-xs">
            Zum Bestätigen "{name}" eingeben
          </Label>
          <Input
            id="object-drop-confirm"
            value={confirmName}
            autoComplete="off"
            onChange={(event) => setConfirmName(event.target.value)}
            placeholder={name}
          />
        </div>
      </div>
    </DdlPreviewDialog>
  );
}
