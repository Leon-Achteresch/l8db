import { useState } from "react";
import { toast } from "sonner";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BindParamRef, BindParamValue } from "@/lib/bind-params";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import {
  type ParameterSet,
  parameterScope,
  parameterValues,
  saveParameterSet,
} from "@/lib/workbench/parameter-sets";
import { deleteWorkbenchRecord } from "@/lib/workbench/records";
import { useWorkbenchRecords } from "@/lib/workbench/use-records";

interface Props {
  connectionId: string;
  database: string | null;
  sql: string;
  refs: BindParamRef[];
  values: Record<string, BindParamValue>;
  onValuesChange: (values: Record<string, BindParamValue>) => void;
}
export function ParameterSets({
  connectionId,
  database,
  sql,
  refs,
  values,
  onValuesChange,
}: Props) {
  const scope = parameterScope(connectionId, database, sql);
  const { records, loading, error } = useWorkbenchRecords<ParameterSet>("parameters", scope);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const feature = useNewFeatureVisibility<HTMLButtonElement>("query.parameters.sets");
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 border-b pb-3">
      <div className="flex gap-2">
        <Input
          aria-label="Name des Parametersatzes"
          placeholder="Parametersatz benennen"
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          ref={feature.ref}
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !name.trim()}
          onClick={() =>
            void act(async () => {
              await saveParameterSet(scope, name, sql, refs, values);
              setName("");
              toast.success("Parametersatz gespeichert");
            })
          }
        >
          Werte merken {feature.isNew && <NewBadge />}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Nur bewusst gespeicherte Werte bleiben lokal erhalten. Lade einen Satz und prüfe die Werte
        vor dem Ausführen.
      </p>
      {loading && (
        <p role="status" className="text-xs">
          Parametersätze werden geladen…
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="max-h-32 overflow-auto">
        {records.map((entry) => (
          <div key={entry.id} className="flex items-center gap-2">
            <Button
              type="button"
              className="min-w-0 flex-1 justify-start truncate"
              variant="ghost"
              size="sm"
              onClick={() => {
                try {
                  onValuesChange(parameterValues(refs, entry.value.values));
                } catch (error) {
                  toast.error(String(error));
                }
              }}
            >
              {entry.name}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-label={`Parametersatz ${entry.name} löschen`}
              onClick={() => void act(() => deleteWorkbenchRecord(entry.id))}
            >
              Löschen
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
