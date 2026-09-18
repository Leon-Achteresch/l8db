import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronsUpDownIcon, LayersIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { SchemaLogo } from "@/components/named-logo";
import { ProviderLogo } from "@/components/provider-logo";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConnectionPicker } from "@/features/connections/connection-picker";
import { DdlPreviewDialog } from "@/features/ddl/ddl-preview-dialog";
import { providerFor } from "@/lib/connection-url";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { listSchemas, previewSchemaObjectCopy, type SchemaCopyObjectType } from "@/lib/db";
import { useActiveDatabase, useDbSelectionStore } from "@/lib/db-selection";
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
  const setSchema = useDbSelectionStore((state) => state.setSchema);
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
  const targetConnection = connections.find((entry) => entry.id === targetConnectionId) ?? null;
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
      setSchema(targetConnectionId, schema);
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
          <ConnectionPicker
            value={targetConnectionId}
            onSelect={setTargetConnectionId}
            kind={connection?.kind}
            label="Zielverbindung"
            contentClassName="flex max-h-80 w-(--radix-dropdown-menu-trigger-width) min-w-56 flex-col overflow-hidden"
            trigger={
              <button
                type="button"
                className="flex h-9 w-full items-center gap-2 rounded-md border bg-background px-3 text-left text-sm hover:bg-accent"
              >
                {targetConnection ? (
                  <ProviderLogo
                    providerId={providerFor(targetConnection).id}
                    kind={targetConnection.kind}
                    className="size-4"
                  />
                ) : null}
                <span className="flex-1 truncate">
                  {targetConnection?.name ?? "Verbindung wählen…"}
                </span>
                <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
              </button>
            }
          />
        </div>
        <div className="space-y-2">
          <Label>Zielschema</Label>
          <Select value={targetSchema} onValueChange={setTargetSchema}>
            <SelectTrigger className="w-full min-w-0" aria-label="Zielschema" title={targetSchema}>
              {schemas?.includes(targetSchema) ? null : (
                <LayersIcon className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <SelectValue placeholder="Wählen…" />
            </SelectTrigger>
            <SelectContent searchable>
              {(schemas ?? []).map((entry) => (
                <SelectItem key={entry} value={entry}>
                  <span className="flex min-w-0 items-center gap-2">
                    <SchemaLogo name={entry} />
                    <span className="truncate">{entry}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </DdlPreviewDialog>
  );
}
