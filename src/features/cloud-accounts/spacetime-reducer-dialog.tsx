import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { type SpacetimeReducer, spacetimeCallReducer } from "@/lib/db/cloud-accounts";
import { cloudErrorText } from "./add-cloud-connection";
import { CloudField } from "./cloud-field";
import { parseReducerArgument } from "./reducer-arguments";

export function SpacetimeReducerDialog({
  accountId,
  database,
  reducer,
  open,
  onOpenChange,
}: {
  accountId: string;
  database: string;
  reducer: SpacetimeReducer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const confirmId = useId();
  const [values, setValues] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValues(reducer.params.map(() => ""));
    setConfirmed(false);
    setError(null);
  }, [open, reducer]);

  async function call() {
    setBusy(true);
    setError(null);
    try {
      const args = reducer.params.map((param, index) =>
        parseReducerArgument(values[index] ?? "", param.type_name),
      );
      const outcome = await spacetimeCallReducer(accountId, database, reducer.name, args, true);
      toast.success(`Reducer „${reducer.name}“ ausgeführt`, {
        description: outcome.message ?? `HTTP ${outcome.status}`,
      });
      onOpenChange(false);
    } catch (reason) {
      setError(
        reason instanceof SyntaxError
          ? "Ein Argument ist kein gültiges JSON."
          : cloudErrorText(reason),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reducer {reducer.name} aufrufen</DialogTitle>
          <DialogDescription>
            Reducer verändern Daten in {database}. Argumente als JSON eingeben, Texte ohne
            Anführungszeichen.
          </DialogDescription>
        </DialogHeader>
        <form
          id={`reducer-${reducer.name}`}
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (confirmed) void call();
          }}
        >
          {reducer.params.map((param, index) => (
            <CloudField
              key={param.name}
              id={`reducer-${reducer.name}-${param.name}`}
              label={`${param.name} (${param.type_name})`}
            >
              <Input
                id={`reducer-${reducer.name}-${param.name}`}
                value={values[index] ?? ""}
                onChange={(event) =>
                  setValues((current) =>
                    current.map((value, position) =>
                      position === index ? event.target.value : value,
                    ),
                  )
                }
                spellCheck={false}
                autoComplete="off"
              />
            </CloudField>
          ))}
          {reducer.params.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Dieser Reducer erwartet keine Argumente.
            </p>
          )}
          <div className="flex items-start gap-2 text-sm">
            <Checkbox
              id={confirmId}
              checked={confirmed}
              onCheckedChange={(value) => setConfirmed(value === true)}
            />
            <label htmlFor={confirmId} className="leading-tight">
              Ich möchte diesen Reducer jetzt ausführen und Daten verändern.
            </label>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button type="submit" form={`reducer-${reducer.name}`} disabled={!confirmed || busy}>
            {busy ? "Führe aus…" : "Ausführen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
