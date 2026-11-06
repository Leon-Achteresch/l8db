import { SaveIcon, XIcon } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DataTypeCombobox } from "@/features/alter-table/alter-table-view/data-type-combobox";
import {
  columnEditSupport,
  DEFAULT_EXPRESSION_HINT,
  nullableLocked,
} from "@/features/alter-table/alter-table-view/data-types";
import type { AddColumnRequest, DatabaseKind } from "@/lib/db";

interface AddColumnRowProps {
  addForm: AddColumnRequest;
  setAddForm: Dispatch<SetStateAction<AddColumnRequest>>;
  kind: DatabaseKind;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}

export function AddColumnRow({
  addForm,
  setAddForm,
  kind,
  saving,
  onSave,
  onCancel,
}: AddColumnRowProps) {
  const { addConstraints } = columnEditSupport(kind);
  const locked = nullableLocked(kind, addForm.data_type);
  return (
    <div className="grid grid-cols-[1fr_1fr_80px_1fr_auto] gap-px border-b bg-muted">
      <div className="bg-background px-3 py-1.5">
        <Input
          aria-label="Name der neuen Spalte"
          value={addForm.name}
          onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="column_name"
          className="h-7 text-xs"
          autoFocus
        />
      </div>
      <div className="bg-background px-3 py-1.5">
        <DataTypeCombobox
          value={addForm.data_type}
          onChange={(v) => setAddForm((f) => ({ ...f, data_type: v }))}
          kind={kind}
        />
      </div>
      <div className="flex items-center bg-background px-3 py-1.5">
        <Switch
          size="sm"
          checked={addConstraints && !locked ? addForm.is_nullable : !locked}
          disabled={!addConstraints || locked}
          onCheckedChange={(is_nullable) => setAddForm((f) => ({ ...f, is_nullable }))}
          aria-label="NULL-Werte in der neuen Spalte erlauben"
          title={
            locked
              ? "Dieser Typ kann in ClickHouse nicht Nullable sein."
              : addConstraints
                ? undefined
                : "Diese Datenbank unterstützt hier kein NOT NULL."
          }
        />
      </div>
      <div className="bg-background px-3 py-1.5">
        <Input
          aria-label="Standardwert der neuen Spalte"
          title={
            addConstraints
              ? DEFAULT_EXPRESSION_HINT
              : "Diese Datenbank unterstützt hier keine Standardwerte."
          }
          disabled={!addConstraints}
          value={addForm.default_value ?? ""}
          onChange={(e) =>
            setAddForm((f) => ({
              ...f,
              default_value: e.target.value || undefined,
            }))
          }
          placeholder="SQL-Ausdruck, z. B. 'Text'"
          className="h-7 font-mono text-xs"
        />
      </div>
      <div className="flex items-center gap-1 bg-background px-3 py-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={onSave}
          disabled={saving || !addForm.name.trim()}
          aria-label="Spalte hinzufügen"
        >
          <SaveIcon className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={onCancel}
          aria-label="Abbrechen"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
