import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { StudioColumn, StudioRow } from "@/lib/db/supabase-studio-tables";
import { apiValue, cellText, isBooleanType, isJsonType } from "./supabase-tables-utils";

type FieldMode = "value" | "null" | "default" | "keep";

interface Field {
  mode: FieldMode;
  text: string;
}

function initialFields(columns: StudioColumn[], row: StudioRow | null): Record<string, Field> {
  return Object.fromEntries(
    columns.map((column) => {
      if (row) return [column.name, { mode: "keep", text: cellText(row[column.name]) }];
      const automatic =
        column.default_value !== null ||
        column.is_identity ||
        column.is_generated ||
        column.nullable;
      return [column.name, { mode: automatic ? "default" : "value", text: "" }];
    }),
  );
}

export function SupabaseTableRowDialog({
  open,
  columns,
  row,
  sql,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  columns: StudioColumn[];
  row: StudioRow | null;
  sql: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: StudioRow) => Promise<void>;
}) {
  const [fields, setFields] = useState(() => initialFields(columns, row));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(name: string, patch: Partial<Field>) {
    setFields((current) => ({ ...current, [name]: { ...current[name], ...patch } }));
  }

  async function submit() {
    setError(null);
    try {
      const values: StudioRow = {};
      for (const column of columns) {
        const field = fields[column.name];
        if (!field || field.mode === "default" || field.mode === "keep") continue;
        values[column.name] =
          field.mode === "null" ? null : apiValue(field.text, column, row?.[column.name], sql);
      }
      if (row && Object.keys(values).length === 0) {
        setError("Keine Änderung angegeben.");
        return;
      }
      setBusy(true);
      await onSubmit(values);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{row ? "Zeile bearbeiten" : "Zeile einfügen"}</DialogTitle>
          <DialogDescription>
            {row
              ? "Nur geänderte Felder werden gespeichert."
              : "Felder mit „Standard“ werden weggelassen und von der Datenbank befüllt."}
          </DialogDescription>
        </DialogHeader>
        <form
          id="supabase-table-row-form"
          className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {columns.map((column) => {
            const field = fields[column.name] ?? { mode: "value", text: "" };
            const disabled = column.is_generated || field.mode === "null";
            const setText = (text: string) => update(column.name, { text, mode: "value" });
            return (
              <div key={column.name} className="grid gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-medium">{column.name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {column.data_type || "unbekannt"}
                  </span>
                  {column.is_primary_key && <Badge variant="outline">PK</Badge>}
                  {column.default_value && (
                    <span className="truncate text-[11px] text-muted-foreground">
                      Standard: {column.default_value}
                    </span>
                  )}
                  <Select
                    value={field.mode}
                    onValueChange={(mode) => update(column.name, { mode: mode as FieldMode })}
                  >
                    <SelectTrigger
                      size="sm"
                      className="ml-auto h-7 w-36 text-xs"
                      aria-label={`Modus für ${column.name}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="value">Wert</SelectItem>
                      {column.nullable && <SelectItem value="null">NULL</SelectItem>}
                      {row ? (
                        <SelectItem value="keep">Unverändert</SelectItem>
                      ) : (
                        <SelectItem value="default">Standard</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {column.enum_values?.length || isBooleanType(column.data_type) ? (
                  <Select value={field.text} onValueChange={setText} disabled={disabled}>
                    <SelectTrigger size="sm" className="h-8 text-xs" aria-label={column.name}>
                      <SelectValue placeholder="Wert wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      {(column.enum_values ?? ["true", "false"]).map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : isJsonType(column.data_type) || field.text.includes("\n") ? (
                  <Textarea
                    value={field.text}
                    onChange={(event) => setText(event.target.value)}
                    disabled={disabled}
                    aria-label={column.name}
                    spellCheck={false}
                    className="min-h-20 font-mono text-xs"
                  />
                ) : (
                  <Input
                    value={field.text}
                    onChange={(event) => setText(event.target.value)}
                    disabled={disabled}
                    aria-label={column.name}
                    spellCheck={false}
                    autoComplete="off"
                    className="h-8 font-mono text-xs"
                  />
                )}
              </div>
            );
          })}
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
          <Button type="submit" form="supabase-table-row-form" disabled={busy}>
            {busy ? "Speichert…" : row ? "Speichern" : "Einfügen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
