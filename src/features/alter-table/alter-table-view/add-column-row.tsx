import { SaveIcon, XIcon } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTypeCombobox } from "@/features/alter-table/alter-table-view/data-type-combobox";
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
  return (
    <div className="grid grid-cols-[1fr_1fr_80px_1fr_auto] gap-px border-b bg-muted">
      <div className="bg-background px-3 py-1.5">
        <Input
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
        <button
          type="button"
          onClick={() => setAddForm((f) => ({ ...f, is_nullable: !f.is_nullable }))}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {addForm.is_nullable ? "YES" : "NO"}
        </button>
      </div>
      <div className="bg-background px-3 py-1.5">
        <Input
          value={addForm.default_value ?? ""}
          onChange={(e) =>
            setAddForm((f) => ({
              ...f,
              default_value: e.target.value || undefined,
            }))
          }
          placeholder="DEFAULT"
          className="h-7 text-xs"
        />
      </div>
      <div className="flex items-center gap-1 bg-background px-3 py-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={onSave}
          disabled={saving || !addForm.name.trim()}
        >
          <SaveIcon className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="size-6" onClick={onCancel}>
          <XIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
