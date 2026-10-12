import { KeyRoundIcon, LinkIcon, Trash2Icon } from "lucide-react";
import { IconButton } from "@/components/icon-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type FormColumn, joinType, splitType } from "@/features/tables/create-table-view/columns";
import type { ColumnDefinition } from "@/lib/db";

const CELL_INPUT =
  "h-7 rounded-md border-transparent bg-transparent px-2 font-mono text-xs shadow-none hover:border-input focus-visible:border-ring dark:bg-transparent";

interface CreateTableColumnRowProps {
  column: FormColumn;
  typeOptions: { base: string; length: string }[];
  foreignKey: boolean;
  removable: boolean;
  onChange: (patch: Partial<ColumnDefinition>) => void;
  onRemove: () => void;
}

export function CreateTableColumnRow({
  column,
  typeOptions,
  foreignKey,
  removable,
  onChange,
  onRemove,
}: CreateTableColumnRowProps) {
  const { base, length } = splitType(column.data_type);
  const bases = typeOptions.some((option) => option.base === base)
    ? typeOptions
    : [{ base, length: "" }, ...typeOptions];
  const label = column.name || "Spalte";
  return (
    <tr className="group h-9 border-b hover:bg-muted/30">
      <td className="pl-2">
        <div className="flex items-center gap-1">
          <span className="flex w-4 shrink-0 justify-center">
            {column.is_primary_key ? (
              <KeyRoundIcon className="size-3.5 text-amber-500" aria-label="Primärschlüssel" />
            ) : foreignKey ? (
              <LinkIcon className="size-3.5 text-primary" aria-label="Fremdschlüssel" />
            ) : null}
          </span>
          <Input
            value={column.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="spaltenname"
            aria-label="Spaltenname"
            className={CELL_INPUT}
          />
        </div>
      </td>
      <td>
        <Select
          value={base}
          onValueChange={(value) => {
            const fallback = typeOptions.find((option) => option.base === value)?.length ?? "";
            onChange({ data_type: joinType(value, fallback ? length || fallback : "") });
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label={`Typ von ${label}`}
            className="h-7 w-full border-transparent bg-transparent font-mono text-xs shadow-none hover:border-input dark:bg-transparent"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent searchable>
            {bases.map((option) => (
              <SelectItem key={option.base} value={option.base} className="font-mono text-xs">
                {option.base}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td>
        <Input
          value={length}
          onChange={(e) => onChange({ data_type: joinType(base, e.target.value) })}
          aria-label={`Länge von ${label}`}
          inputMode="numeric"
          className={`${CELL_INPUT} text-right tabular-nums`}
        />
      </td>
      <td>
        <div className="flex justify-center">
          <Checkbox
            aria-label={`${label} nullable`}
            checked={column.is_nullable}
            onCheckedChange={(v) => onChange({ is_nullable: Boolean(v) })}
          />
        </div>
      </td>
      <td>
        <Input
          value={column.default_value ?? ""}
          onChange={(e) => onChange({ default_value: e.target.value || null })}
          placeholder={column.is_nullable ? "NULL" : ""}
          aria-label={`Default von ${label}`}
          className={CELL_INPUT}
        />
      </td>
      <td>
        <div className="flex justify-center">
          <Checkbox
            aria-label={`${label} Primärschlüssel`}
            checked={column.is_primary_key}
            onCheckedChange={(v) => onChange({ is_primary_key: Boolean(v) })}
          />
        </div>
      </td>
      <td>
        <div className="flex justify-center">
          <Checkbox
            aria-label={`${label} unique`}
            checked={column.is_unique}
            disabled={column.is_primary_key}
            onCheckedChange={(v) => onChange({ is_unique: Boolean(v) })}
          />
        </div>
      </td>
      <td className="pr-1 text-right">
        <IconButton
          size="icon-xs"
          variant="ghost"
          className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
          aria-label={`${label} entfernen`}
          disabled={!removable}
          onClick={onRemove}
        >
          <Trash2Icon />
        </IconButton>
      </td>
    </tr>
  );
}
