import { Plus, X } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type StudioColumnDefinition,
  studioTablesCreateTable,
} from "@/lib/db/supabase-studio-tables";
import { COMMON_TYPES, type StudioTableRef } from "./supabase-tables-utils";

const FLAGS = [
  { key: "nullable", label: "NULL" },
  { key: "unique", label: "Eindeutig" },
  { key: "primary_key", label: "PK" },
  { key: "identity", label: "Identity" },
] as const;

type DraftColumn = StudioColumnDefinition & { uid: string };

const DEFAULT_COLUMNS: DraftColumn[] = [
  {
    uid: "id",
    name: "id",
    data_type: "bigint",
    default_value: null,
    nullable: false,
    unique: false,
    primary_key: true,
    identity: true,
  },
  {
    uid: "created_at",
    name: "created_at",
    data_type: "timestamptz",
    default_value: "now()",
    nullable: false,
    unique: false,
    primary_key: false,
    identity: false,
  },
];

export function SupabaseTableCreateDialog({
  reference,
  schemas,
  initialSchema,
  onOpenChange,
  onCreated,
}: {
  reference: string;
  schemas: string[];
  initialSchema: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (table: StudioTableRef) => void;
}) {
  const [schema, setSchema] = useState(initialSchema || "public");
  const [name, setName] = useState("");
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [enableRls, setEnableRls] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function change(index: number, patch: Partial<DraftColumn>) {
    setColumns((current) =>
      current.map((column, position) => (position === index ? { ...column, ...patch } : column)),
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await studioTablesCreateTable(reference, {
        schema,
        name: name.trim(),
        enable_rls: enableRls,
        columns: columns.map(({ uid: _uid, ...column }) => ({
          ...column,
          name: column.name.trim(),
          default_value: column.default_value?.trim() || null,
        })),
      });
      onCreated({ schema, name: name.trim() });
      onOpenChange(false);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !busy && onOpenChange(open)}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Tabelle erstellen</DialogTitle>
          <DialogDescription>
            Standardwerte sind SQL-Ausdrücke. Identity-Spalten zählen automatisch hoch.
          </DialogDescription>
        </DialogHeader>
        <form
          id="supabase-table-create-form"
          className="grid max-h-[65vh] gap-3 overflow-y-auto pr-1"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
            <Label className="grid gap-1 text-xs">
              Schema
              <Select value={schema} onValueChange={setSchema}>
                <SelectTrigger size="sm" className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set(["public", ...schemas])].map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
            <Label className="grid gap-1 text-xs">
              Name
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                autoFocus
                spellCheck={false}
                className="font-mono"
              />
            </Label>
          </div>
          <p className="text-xs font-medium">Spalten</p>
          {columns.map((column, index) => (
            <div
              key={column.uid}
              className="grid items-center gap-2 rounded-lg border p-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]"
            >
              <Input
                value={column.name}
                onChange={(event) => change(index, { name: event.target.value })}
                placeholder="Name"
                aria-label="Spaltenname"
                spellCheck={false}
                className="h-8 font-mono text-xs"
              />
              <Input
                value={column.data_type}
                onChange={(event) => change(index, { data_type: event.target.value })}
                list="supabase-table-create-types"
                placeholder="Typ"
                aria-label="Datentyp"
                spellCheck={false}
                className="h-8 font-mono text-xs"
              />
              <Input
                value={column.default_value ?? ""}
                onChange={(event) => change(index, { default_value: event.target.value })}
                placeholder="Standardwert"
                aria-label="Standardwert"
                disabled={column.identity}
                spellCheck={false}
                className="h-8 font-mono text-xs"
              />
              <div className="flex flex-wrap gap-3">
                {FLAGS.map((flag) => (
                  <Label key={flag.key} className="flex items-center gap-1 text-xs font-normal">
                    <Checkbox
                      checked={column[flag.key]}
                      onCheckedChange={(value) => change(index, { [flag.key]: value === true })}
                    />
                    {flag.label}
                  </Label>
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Spalte entfernen"
                disabled={columns.length === 1}
                onClick={() =>
                  setColumns((current) => current.filter((_, position) => position !== index))
                }
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
          <datalist id="supabase-table-create-types">
            {COMMON_TYPES.map((type) => (
              <option key={type} value={type} />
            ))}
          </datalist>
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={columns.length >= 200}
              onClick={() =>
                setColumns((current) => [
                  ...current,
                  {
                    uid: crypto.randomUUID(),
                    name: "",
                    data_type: "text",
                    default_value: null,
                    nullable: true,
                    unique: false,
                    primary_key: false,
                    identity: false,
                  },
                ])
              }
            >
              <Plus className="size-3.5" /> Spalte
            </Button>
          </div>
          <Label className="flex items-center gap-2 text-sm font-normal">
            <Checkbox
              checked={enableRls}
              onCheckedChange={(value) => setEnableRls(value === true)}
            />
            Row Level Security aktivieren (empfohlen, ohne Richtlinie ist die Tabelle über die Data
            API gesperrt)
          </Label>
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
          <Button
            type="submit"
            form="supabase-table-create-form"
            disabled={busy || !name.trim() || columns.some((column) => !column.name.trim())}
          >
            {busy ? "Erstellt…" : "Erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
