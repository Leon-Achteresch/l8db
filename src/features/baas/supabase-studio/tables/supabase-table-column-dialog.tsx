import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import type {
  StudioColumn,
  StudioColumnChange,
  StudioColumnDefinition,
} from "@/lib/db/supabase-studio-tables";
import { COMMON_TYPES } from "./supabase-tables-utils";

export function SupabaseTableColumnDialog({
  column,
  onOpenChange,
  onAdd,
  onAlter,
}: {
  column: StudioColumn | null;
  onOpenChange: (open: boolean) => void;
  onAdd: (definition: StudioColumnDefinition) => Promise<void>;
  onAlter: (change: StudioColumnChange) => Promise<void>;
}) {
  const [name, setName] = useState(column?.name ?? "");
  const [dataType, setDataType] = useState(column?.data_type ?? "text");
  const [defaultValue, setDefaultValue] = useState(column?.default_value ?? "");
  const [nullable, setNullable] = useState(column?.nullable ?? true);
  const [unique, setUnique] = useState(false);
  const [primaryKey, setPrimaryKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (column) {
        const trimmedDefault = defaultValue.trim();
        await onAlter({
          new_name: name.trim() !== column.name ? name.trim() : null,
          data_type: dataType.trim() !== column.data_type ? dataType.trim() : null,
          default_value:
            trimmedDefault && trimmedDefault !== column.default_value ? trimmedDefault : null,
          drop_default: !trimmedDefault && column.default_value !== null,
          nullable: nullable !== column.nullable ? nullable : null,
        });
      } else {
        await onAdd({
          name: name.trim(),
          data_type: dataType.trim(),
          default_value: defaultValue.trim() || null,
          nullable,
          unique,
          primary_key: primaryKey,
          identity: false,
        });
      }
      onOpenChange(false);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !busy && onOpenChange(open)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{column ? `Spalte ${column.name} ändern` : "Spalte hinzufügen"}</DialogTitle>
          <DialogDescription>
            Standardwerte sind SQL-Ausdrücke, z. B. now(), gen_random_uuid() oder 'Text'.
          </DialogDescription>
        </DialogHeader>
        <form
          id="supabase-table-column-form"
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Label className="grid gap-1 text-xs">
            Name
            <Input value={name} onChange={(event) => setName(event.target.value)} required />
          </Label>
          <Label className="grid gap-1 text-xs">
            Datentyp
            <Input
              value={dataType}
              onChange={(event) => setDataType(event.target.value)}
              list="supabase-table-column-types"
              required
              className="font-mono"
            />
            <datalist id="supabase-table-column-types">
              {COMMON_TYPES.map((type) => (
                <option key={type} value={type} />
              ))}
            </datalist>
          </Label>
          <Label className="grid gap-1 text-xs">
            Standardwert
            <Input
              value={defaultValue}
              onChange={(event) => setDefaultValue(event.target.value)}
              placeholder="leer = kein Standardwert"
              className="font-mono"
            />
          </Label>
          <Label className="flex items-center gap-2 text-sm font-normal">
            <Checkbox checked={nullable} onCheckedChange={(value) => setNullable(value === true)} />
            NULL erlaubt
          </Label>
          {!column && (
            <>
              <Label className="flex items-center gap-2 text-sm font-normal">
                <Checkbox checked={unique} onCheckedChange={(value) => setUnique(value === true)} />
                Eindeutig
              </Label>
              <Label className="flex items-center gap-2 text-sm font-normal">
                <Checkbox
                  checked={primaryKey}
                  onCheckedChange={(value) => setPrimaryKey(value === true)}
                />
                Primärschlüssel
              </Label>
            </>
          )}
        </form>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Abbrechen
          </Button>
          <Button type="submit" form="supabase-table-column-form" disabled={busy || !name.trim()}>
            {busy ? "Speichert…" : "Speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
