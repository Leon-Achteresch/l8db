import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  KeyRoundIcon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  TrashIcon,
  XIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { SPRING_LAYOUT } from "@/lib/ease";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { useActiveConnection } from "@/lib/connections";
import {
  type AddColumnRequest,
  type AlterColumnRequest,
  addColumn,
  alterColumn,
  type DatabaseKind,
  type DetailedColumnInfo,
  dropColumn,
  listTableColumnsDetailed,
} from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";
import { cn } from "@/lib/utils";

interface DataTypeGroup {
  label: string;
  types: string[];
}

const POSTGRES_TYPES: DataTypeGroup[] = [
  {
    label: "Numerisch",
    types: [
      "smallint",
      "integer",
      "bigint",
      "decimal",
      "numeric",
      "real",
      "double precision",
      "smallserial",
      "serial",
      "bigserial",
    ],
  },
  {
    label: "Text",
    types: ["character varying", "varchar", "character", "char", "text", "citext"],
  },
  {
    label: "Datum / Zeit",
    types: [
      "timestamp without time zone",
      "timestamp with time zone",
      "date",
      "time without time zone",
      "time with time zone",
      "interval",
    ],
  },
  {
    label: "Boolean",
    types: ["boolean"],
  },
  {
    label: "Binär",
    types: ["bytea"],
  },
  {
    label: "UUID",
    types: ["uuid"],
  },
  {
    label: "JSON",
    types: ["json", "jsonb"],
  },
  {
    label: "Netzwerk",
    types: ["inet", "cidr", "macaddr", "macaddr8"],
  },
  {
    label: "Geometrie",
    types: ["point", "line", "lseg", "box", "path", "polygon", "circle"],
  },
  {
    label: "Array",
    types: ["integer[]", "text[]", "boolean[]", "varchar[]", "bigint[]", "uuid[]", "jsonb[]"],
  },
  {
    label: "Bereich",
    types: ["int4range", "int8range", "numrange", "tsrange", "tstzrange", "daterange"],
  },
  {
    label: "Sonstige",
    types: [
      "money",
      "bit",
      "bit varying",
      "tsvector",
      "tsquery",
      "xml",
      "oid",
      "pg_lsn",
      "pg_snapshot",
    ],
  },
];

function getDataTypeGroups(_kind: DatabaseKind): DataTypeGroup[] {
  return POSTGRES_TYPES;
}

interface DataTypeComboboxProps {
  value: string;
  onChange: (value: string) => void;
  kind: DatabaseKind;
  className?: string;
}

function DataTypeCombobox({ value, onChange, kind, className }: DataTypeComboboxProps) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => getDataTypeGroups(kind), [kind]);

  const allTypes = useMemo(() => groups.flatMap((g) => g.types), [groups]);

  const isCustom = value !== "" && !allTypes.includes(value.toLowerCase());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-7 w-full items-center justify-between rounded-md border border-input bg-background px-2 text-left text-xs ring-offset-background hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <span className="truncate font-mono">{value || "Typ wählen…"}</span>
          <ChevronsUpDownIcon className="ml-1 size-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Typ suchen…" className="h-8 text-xs" />
          <CommandList className="max-h-60">
            <CommandEmpty>Kein Typ gefunden.</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.label} heading={group.label}>
                {group.types.map((t) => (
                  <CommandItem
                    key={t}
                    value={t}
                    onSelect={(v) => {
                      onChange(v);
                      setOpen(false);
                    }}
                    className="text-xs"
                  >
                    <span className="font-mono">{t}</span>
                    {value.toLowerCase() === t && <CheckIcon className="ml-auto size-3.5" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
        {isCustom && (
          <div className="border-t px-2 py-1.5 text-[10px] text-muted-foreground">
            Aktuell: <span className="font-mono">{value}</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface AlterTableViewProps {
  schema: string;
  table: string;
}

export function AlterTableView({ schema, table }: AlterTableViewProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();

  const {
    data: columns,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["table-columns-detailed", connection?.id, database, schema, table],
    queryFn: () =>
      listTableColumnsDetailed(
        connection!.kind,
        effectiveConnectionString(connection!),
        schema,
        table,
        database ?? undefined,
      ),
    enabled: !!connection,
  });

  const [editingColumn, setEditingColumn] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<AlterColumnRequest>({
    old_name: "",
    drop_default: false,
  });
  const [addingColumn, setAddingColumn] = useState(false);
  const [addForm, setAddForm] = useState<AddColumnRequest>({
    name: "",
    data_type: "text",
    is_nullable: true,
  });
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["table-columns-detailed", connection?.id, database, schema, table],
    });
    await queryClient.invalidateQueries({ queryKey: ["columns"] });
  };

  const handleStartEdit = (col: DetailedColumnInfo) => {
    setEditingColumn(col.name);
    setEditForm({
      old_name: col.name,
      new_name: col.name,
      data_type: col.data_type,
      set_not_null: !col.is_nullable,
      new_default: col.column_default ?? undefined,
      drop_default: false,
    });
  };

  const handleCancelEdit = () => {
    setEditingColumn(null);
  };

  const handleSaveEdit = async () => {
    if (!connection) return;
    setSaving(true);
    try {
      const original = columns?.find((c) => c.name === editForm.old_name);
      if (!original) return;

      const changes: AlterColumnRequest = {
        old_name: editForm.old_name,
        drop_default: false,
      };

      if (editForm.new_name && editForm.new_name !== original.name) {
        changes.new_name = editForm.new_name;
      }
      if (editForm.data_type && editForm.data_type !== original.data_type) {
        changes.data_type = editForm.data_type;
      }
      const wantNotNull = editForm.set_not_null ?? false;
      if (wantNotNull !== !original.is_nullable) {
        changes.set_not_null = wantNotNull;
      }

      const newDefault = editForm.new_default?.trim() ?? "";
      const oldDefault = original.column_default ?? "";
      if (newDefault !== oldDefault) {
        if (newDefault === "" && oldDefault !== "") {
          changes.drop_default = true;
        } else if (newDefault !== "") {
          changes.new_default = newDefault;
        }
      }

      await alterColumn(
        connection.kind,
        effectiveConnectionString(connection),
        schema,
        table,
        changes,
        database ?? undefined,
      );
      toast.success(`Spalte "${editForm.old_name}" aktualisiert.`);
      setEditingColumn(null);
      await invalidate();
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleAddColumn = async () => {
    if (!connection || !addForm.name.trim()) return;
    setSaving(true);
    try {
      await addColumn(
        connection.kind,
        effectiveConnectionString(connection),
        schema,
        table,
        addForm,
        database ?? undefined,
      );
      toast.success(`Spalte "${addForm.name}" hinzugefügt.`);
      setAddingColumn(false);
      setAddForm({ name: "", data_type: "text", is_nullable: true });
      await invalidate();
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDropColumn = async () => {
    if (!connection || !dropTarget) return;
    setSaving(true);
    try {
      await dropColumn(
        connection.kind,
        effectiveConnectionString(connection),
        schema,
        table,
        dropTarget,
        database ?? undefined,
      );
      toast.success(`Spalte "${dropTarget}" gelöscht.`);
      setDropTarget(null);
      await invalidate();
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!connection) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Keine aktive Verbindung.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
        <Spinner />
        Lade Spalten…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center text-destructive">
        {String(error)}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">
            {schema}.{table}
          </h2>
          <Badge variant="outline" className="text-xs">
            {columns?.length ?? 0} Spalten
          </Badge>
        </div>
        <Button
          variant="outline"
          size="xs"
          onClick={() => {
            setAddingColumn(true);
            setAddForm({ name: "", data_type: "text", is_nullable: true });
          }}
          disabled={addingColumn}
        >
          <PlusIcon data-icon="inline-start" />
          Spalte hinzufügen
        </Button>
      </div>

      <AlertDialog
        open={dropTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDropTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Spalte &quot;{dropTarget}&quot; löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Die Spalte und alle abhängigen Constraints werden unwiderruflich gelöscht (DROP COLUMN
              CASCADE).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleDropColumn} disabled={saving}>
              {saving ? <Spinner className="size-4" /> : null}
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex-1 overflow-auto">
        <div className="min-w-0">
          <div className="grid grid-cols-[1fr_1fr_80px_1fr_auto] gap-px border-b bg-muted text-xs font-medium text-muted-foreground">
            <div className="bg-background px-4 py-2">Name</div>
            <div className="bg-background px-4 py-2">Datentyp</div>
            <div className="bg-background px-4 py-2">Nullable</div>
            <div className="bg-background px-4 py-2">Default</div>
            <div className="bg-background px-4 py-2 text-right">Aktionen</div>
          </div>

          {addingColumn && (
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
                  kind={connection.kind}
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
                  onClick={handleAddColumn}
                  disabled={saving || !addForm.name.trim()}
                >
                  <SaveIcon className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() => setAddingColumn(false)}
                >
                  <XIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          )}

          {columns?.map((col) => (
            <motion.div
              key={col.name}
              layout
              transition={{ layout: SPRING_LAYOUT }}
              className="group grid grid-cols-[1fr_1fr_80px_1fr_auto] gap-px border-b bg-muted text-sm"
            >
              {editingColumn === col.name ? (
                <>
                  <div className="bg-background px-3 py-1.5">
                    <Input
                      value={editForm.new_name ?? col.name}
                      onChange={(e) => setEditForm((f) => ({ ...f, new_name: e.target.value }))}
                      className="h-7 text-xs"
                      autoFocus
                    />
                  </div>
                  <div className="bg-background px-3 py-1.5">
                    <DataTypeCombobox
                      value={editForm.data_type ?? col.data_type}
                      onChange={(v) => setEditForm((f) => ({ ...f, data_type: v }))}
                      kind={connection.kind}
                    />
                  </div>
                  <div className="flex items-center bg-background px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setEditForm((f) => ({ ...f, set_not_null: !(f.set_not_null ?? false) }))
                      }
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {editForm.set_not_null ? "NO" : "YES"}
                    </button>
                  </div>
                  <div className="bg-background px-3 py-1.5">
                    <Input
                      value={editForm.new_default ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, new_default: e.target.value }))}
                      placeholder="DEFAULT"
                      className="h-7 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-1 bg-background px-3 py-1.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={handleSaveEdit}
                      disabled={saving}
                    >
                      <SaveIcon className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={handleCancelEdit}
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1.5 bg-background px-4 py-2">
                    {col.is_primary_key && (
                      <KeyRoundIcon className="size-3.5 shrink-0 text-amber-500" />
                    )}
                    <span className="truncate">{col.name}</span>
                  </div>
                  <div className="flex items-center bg-background px-4 py-2 font-mono text-xs text-muted-foreground">
                    {col.data_type}
                    {col.character_maximum_length !== null && `(${col.character_maximum_length})`}
                  </div>
                  <div className="flex items-center bg-background px-4 py-2 text-xs text-muted-foreground">
                    {col.is_nullable ? "YES" : "NO"}
                  </div>
                  <div className="flex items-center bg-background px-4 py-2 font-mono text-xs text-muted-foreground">
                    <span className="truncate">{col.column_default ?? ""}</span>
                  </div>
                  <div className="flex items-center gap-1 bg-background px-3 py-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={() => handleStartEdit(col)}
                    >
                      <PencilIcon className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-destructive hover:text-destructive"
                      onClick={() => setDropTarget(col.name)}
                    >
                      <TrashIcon className="size-3.5" />
                    </Button>
                  </div>
                </>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
