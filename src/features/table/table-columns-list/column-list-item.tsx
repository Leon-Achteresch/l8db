import { CheckCheckIcon, CopyIcon, PencilIcon, SaveIcon, XIcon } from "lucide-react";
import { motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DataTypeCombobox } from "@/features/alter-table/alter-table-view/data-type-combobox";
import { copyText } from "@/lib/clipboard";
import type { AlterColumnRequest, DatabaseKind, DetailedColumnInfo } from "@/lib/db";
import { getTypeConfig } from "./column-type-config";

export function ColumnListItem({
  column,
  copiedColumn,
  setCopiedColumn,
  editable,
  editing,
  editForm,
  setEditForm,
  kind,
  saving,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
}: {
  column: DetailedColumnInfo;
  copiedColumn: string | null;
  setCopiedColumn: (name: string | null) => void;
  editable: boolean;
  editing: boolean;
  editForm: AlterColumnRequest;
  setEditForm: (
    form: AlterColumnRequest | ((form: AlterColumnRequest) => AlterColumnRequest),
  ) => void;
  kind?: DatabaseKind;
  saving: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
}) {
  const dataType =
    column.character_maximum_length != null
      ? `${column.data_type}(${column.character_maximum_length})`
      : column.data_type;
  const typeConfig = getTypeConfig(column.data_type, column.is_primary_key);
  const IconComponent = typeConfig.icon;

  return (
    <motion.div
      layout
      variants={{ hidden: { opacity: 0, y: 6 }, visible: { opacity: 1, y: 0 } }}
      className={`group grid min-w-[720px] grid-cols-[minmax(190px,1.5fr)_minmax(145px,1fr)_90px_minmax(180px,1.3fr)_auto] items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
        editing
          ? "border-primary/50 bg-primary/[0.035] shadow-sm"
          : "border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/25"
      }`}
    >
      {editing && kind ? (
        <>
          <div className="flex items-center gap-2">
            <span className="w-5 text-right text-xs font-semibold text-muted-foreground/60 tabular-nums">
              {column.ordinal_position}
            </span>
            <Input
              aria-label={`Name von ${column.name}`}
              value={editForm.new_name ?? column.name}
              onChange={(event) =>
                setEditForm((form) => ({ ...form, new_name: event.target.value }))
              }
              className="h-8 min-w-0 font-mono text-xs"
              autoFocus
            />
          </div>
          <DataTypeCombobox
            value={editForm.data_type ?? column.data_type}
            onChange={(data_type) => setEditForm((form) => ({ ...form, data_type }))}
            kind={kind}
            className="h-8"
          />
          <div className="flex items-center gap-2">
            <Switch
              size="sm"
              checked={editForm.set_not_null ?? false}
              onCheckedChange={(set_not_null) => setEditForm((form) => ({ ...form, set_not_null }))}
              aria-label={`${column.name} als Pflichtfeld markieren`}
            />
            <span className="text-xs text-muted-foreground">Pflicht</span>
          </div>
          <Input
            aria-label={`Standardwert von ${column.name}`}
            value={editForm.new_default ?? ""}
            onChange={(event) =>
              setEditForm((form) => ({ ...form, new_default: event.target.value }))
            }
            placeholder="Kein Standardwert"
            className="h-8 font-mono text-xs"
          />
          <div className="flex items-center justify-end gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              onClick={onCancelEdit}
              disabled={saving}
            >
              <XIcon className="size-4" />
              <span className="sr-only">Abbrechen</span>
            </Button>
            <Button size="icon" className="size-8" onClick={onSaveEdit} disabled={saving}>
              <SaveIcon className="size-4" />
              <span className="sr-only">Speichern</span>
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="w-5 shrink-0 text-right text-xs font-semibold text-muted-foreground/60 tabular-nums">
              {column.ordinal_position}
            </span>
            <div className={`shrink-0 rounded-md border p-1.5 ${typeConfig.color}`}>
              <IconComponent className="size-3.5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight">{column.name}</p>
              {column.comment && (
                <p className="truncate text-xs text-muted-foreground" title={column.comment}>
                  {column.comment}
                </p>
              )}
              <div className="mt-1 flex gap-1.5">
                {column.is_primary_key && (
                  <Badge
                    variant="outline"
                    className="border-amber-500/20 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-500"
                  >
                    PK
                  </Badge>
                )}
                {!column.is_nullable && (
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                    NOT NULL
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <span className="truncate font-mono text-xs text-muted-foreground" title={dataType}>
            {dataType}
          </span>
          <span className="text-xs text-muted-foreground">
            {column.is_nullable ? "Erlaubt" : "Pflicht"}
          </span>
          <span
            className="truncate font-mono text-xs text-muted-foreground"
            title={column.column_default ?? "Kein Standardwert"}
          >
            {column.column_default ?? "—"}
          </span>
          <div className="flex items-center justify-end gap-1 opacity-70 transition-opacity group-hover:opacity-100">
            {editable && (
              <Button size="icon" variant="ghost" className="size-8" onClick={onStartEdit}>
                <PencilIcon className="size-3.5" />
                <span className="sr-only">{column.name} bearbeiten</span>
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              onClick={() => {
                copyText(column.name);
                setCopiedColumn(column.name);
                setTimeout(() => setCopiedColumn(null), 1500);
              }}
            >
              {copiedColumn === column.name ? (
                <CheckCheckIcon className="size-3.5 text-emerald-500" />
              ) : (
                <CopyIcon className="size-3.5" />
              )}
              <span className="sr-only">{column.name} kopieren</span>
            </Button>
          </div>
        </>
      )}
    </motion.div>
  );
}
