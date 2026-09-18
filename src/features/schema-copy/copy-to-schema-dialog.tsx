import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DdlPreviewDialog } from "@/features/ddl/ddl-preview-dialog";
import { useActiveConnection } from "@/lib/connections";
import {
  executeSchemaObjectCopy,
  listSchemas,
  previewSchemaObjectCopy,
  type SchemaCopyObjectType,
} from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { ensurePassword } from "@/lib/password-prompt";
import { effectiveConnectionString } from "@/lib/ssh";

interface CopyToSchemaDialogProps {
  target: { schema: string; name: string; objectType: SchemaCopyObjectType } | null;
  onClose: () => void;
}

const QUERY_KEYS: Record<SchemaCopyObjectType, string[]> = {
  table: ["tables", "columns", "all-objects"],
  view: ["views", "all-objects"],
  routine: ["functions", "procedures", "all-objects"],
  package: ["functions", "function-definition", "invalid-objects", "all-objects"],
};

export function CopyToSchemaDialog({ target, onClose }: CopyToSchemaDialogProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const { data: schemas } = useQuery({
    queryKey: ["schemas-all", connection?.id, database],
    queryFn: () =>
      listSchemas(connection!.kind, effectiveConnectionString(connection!), database ?? undefined),
    enabled: Boolean(connection && target),
  });
  const [targetSchema, setTargetSchema] = useState("");
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (target) setTargetSchema("");
  }, [target]);

  const candidates = (schemas ?? []).filter((schema) => schema !== target?.schema);
  const enabled = Boolean(connection && target && targetSchema);

  const ddlQuery = useQuery({
    queryKey: ["schema-copy-preview", connection?.id, database, target, targetSchema],
    queryFn: () =>
      previewSchemaObjectCopy(
        connection!.kind,
        effectiveConnectionString(connection!),
        target!.schema,
        targetSchema,
        target!.objectType,
        target!.name,
        database ?? undefined,
      ),
    enabled,
    retry: false,
  });

  const handleConfirm = async () => {
    if (!connection || !target || !targetSchema) return;
    setIsPending(true);
    try {
      if (!(await ensurePassword(connection.id))) return;
      await executeSchemaObjectCopy(
        connection.kind,
        effectiveConnectionString(connection),
        target.schema,
        targetSchema,
        target.objectType,
        target.name,
        database ?? undefined,
      );
      toast.success(`${target.name} in ${targetSchema} erstellt.`);
      for (const key of QUERY_KEYS[target.objectType]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
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
      confirmLabel="Erstellen"
      confirmDisabled={!targetSchema}
      isPending={isPending}
      onConfirm={() => void handleConfirm()}
    >
      <div className="space-y-2">
        <Label>Zielschema</Label>
        <Select value={targetSchema} onValueChange={setTargetSchema}>
          <SelectTrigger>
            <SelectValue placeholder="Schema wählen…" />
          </SelectTrigger>
          <SelectContent>
            {candidates.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                Kein anderes Schema verfügbar.
              </p>
            ) : (
              candidates.map((schema) => (
                <SelectItem key={schema} value={schema}>
                  {schema}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>
    </DdlPreviewDialog>
  );
}
