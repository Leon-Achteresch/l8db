import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DdlPreviewDialog } from "@/features/ddl/ddl-preview-dialog";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { listSchemas, previewSchemaObjectCopy, type SchemaCopyObjectType } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { activateConnectionWithToast, effectiveConnectionString } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";

interface CopyToSchemaDialogProps {
  target: { schema: string; name: string; objectType: SchemaCopyObjectType } | null;
  onClose: () => void;
}

export function CopyToSchemaDialog({ target, onClose }: CopyToSchemaDialogProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const connections = useConnectionsStore((state) => state.connections);
  const openQueryTabWithSql = useTableTabs((state) => state.openQueryTabWithSql);
  const navigate = useNavigate();
  const [targetConnectionId, setTargetConnectionId] = useState("");
  const [targetSchema, setTargetSchema] = useState("");
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (target) {
      setTargetConnectionId(connection?.id ?? "");
      setTargetSchema(target.schema);
    }
  }, [target, connection?.id]);

  const { data: schemas } = useQuery({
    queryKey: ["schemas-all", connection?.id, database],
    queryFn: () =>
      listSchemas(connection!.kind, effectiveConnectionString(connection!), database ?? undefined),
    enabled: Boolean(connection && target),
  });
  const candidates = connections.filter((entry) => entry.kind === connection?.kind);
  const schema = targetSchema.trim();
  const enabled = Boolean(connection && target && schema);

  const ddlQuery = useQuery({
    queryKey: ["schema-copy-preview", connection?.id, database, target, schema],
    queryFn: () =>
      previewSchemaObjectCopy(
        connection!.kind,
        effectiveConnectionString(connection!),
        target!.schema,
        schema,
        target!.objectType,
        target!.name,
        database ?? undefined,
      ),
    enabled,
    retry: false,
  });

  const handleConfirm = async () => {
    if (!target || !targetConnectionId || !ddlQuery.data) return;
    setIsPending(true);
    try {
      if (targetConnectionId !== connection?.id) {
        if (!(await activateConnectionWithToast(targetConnectionId))) return;
      }
      const id = openQueryTabWithSql(ddlQuery.data, `${schema}.${target.name}`);
      onClose();
      void navigate({ to: "/query/$id", params: { id } });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <DdlPreviewDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="In anderem Schema erstellen"
      description={target ? `${target.schema}.${target.name}` : undefined}
      ddl={ddlQuery.data ?? ""}
      ddlError={ddlQuery.error ? String(ddlQuery.error) : null}
      isLoading={ddlQuery.isFetching}
      confirmLabel="Im Editor öffnen"
      confirmDisabled={!targetConnectionId || !schema}
      isPending={isPending}
      onConfirm={() => void handleConfirm()}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Zielverbindung</Label>
          <Select value={targetConnectionId} onValueChange={setTargetConnectionId}>
            <SelectTrigger>
              <SelectValue placeholder="Verbindung wählen…" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="copy-target-schema">Zielschema</Label>
          <Input
            id="copy-target-schema"
            list="copy-target-schemas"
            value={targetSchema}
            onChange={(event) => setTargetSchema(event.target.value)}
          />
          <datalist id="copy-target-schemas">
            {(schemas ?? []).map((entry) => (
              <option key={entry} value={entry} />
            ))}
          </datalist>
        </div>
      </div>
    </DdlPreviewDialog>
  );
}
