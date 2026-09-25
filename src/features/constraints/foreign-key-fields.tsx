import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ColumnMultiSelect } from "@/features/constraints/column-multi-select";
import type { ColumnRef, ConstraintDialectInfo } from "@/lib/constraint-designer";
import type { TableConstraintSpec } from "@/lib/db";

type ForeignKeySpec = Extract<TableConstraintSpec, { kind: "foreign_key" }>;

interface ForeignKeyFieldsProps {
  spec: ForeignKeySpec;
  onChange: (spec: ForeignKeySpec) => void;
  localColumns: ColumnRef[];
  dialect: ConstraintDialectInfo;
  showSchema: boolean;
  target: {
    schemas: string[];
    tables: string[];
    columns: ColumnRef[] | null;
    loadingTables: boolean;
    loadingColumns: boolean;
  };
}

const NO_ACTION = "NO ACTION";

export function ForeignKeyFields({
  spec,
  onChange,
  localColumns,
  dialect,
  showSchema,
  target,
}: ForeignKeyFieldsProps) {
  const patch = (next: Partial<ForeignKeySpec>) => onChange({ ...spec, ...next });

  const actionSelect = (
    label: string,
    value: string | null,
    actions: string[],
    apply: (value: string | null) => void,
  ) =>
    actions.length > 1 && (
      <div className="space-y-1.5">
        <Label className="text-xs">{label}</Label>
        <Select value={value ?? NO_ACTION} onValueChange={(v) => apply(v === NO_ACTION ? null : v)}>
          <SelectTrigger className="h-8 w-full text-xs" aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {actions.map((action) => (
              <SelectItem key={action} value={action} className="font-mono text-xs">
                {action}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Lokale Spalten</Label>
        <ColumnMultiSelect
          label="Lokale Spalten"
          columns={localColumns.map((c) => c.name)}
          value={spec.columns}
          onChange={(columns) => patch({ columns })}
        />
      </div>

      <div className={showSchema ? "grid grid-cols-2 gap-3" : "space-y-1.5"}>
        {showSchema && (
          <div className="space-y-1.5">
            <Label className="text-xs">Referenziertes Schema</Label>
            <Select
              value={spec.ref_schema ?? ""}
              onValueChange={(ref_schema) => patch({ ref_schema, ref_table: "", ref_columns: [] })}
            >
              <SelectTrigger className="h-8 w-full text-xs" aria-label="Referenziertes Schema">
                <SelectValue placeholder="Schema wählen…" />
              </SelectTrigger>
              <SelectContent>
                {target.schemas.map((schema) => (
                  <SelectItem key={schema} value={schema} className="font-mono text-xs">
                    {schema}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs">Referenzierte Tabelle</Label>
          <Select
            value={spec.ref_table}
            onValueChange={(ref_table) => patch({ ref_table, ref_columns: [] })}
            disabled={target.loadingTables && target.tables.length === 0}
          >
            <SelectTrigger className="h-8 w-full text-xs" aria-label="Referenzierte Tabelle">
              <SelectValue placeholder={target.loadingTables ? "Lade…" : "Tabelle wählen…"} />
            </SelectTrigger>
            <SelectContent searchable>
              {target.tables.map((table) => (
                <SelectItem key={table} value={table} className="font-mono text-xs">
                  {table}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {spec.ref_table && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Referenzierte Spalten</Label>
            {target.columns?.some((c) => c.is_primary_key) && (
              <button
                type="button"
                className="text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() =>
                  patch({
                    ref_columns: (target.columns ?? [])
                      .filter((c) => c.is_primary_key)
                      .map((c) => c.name),
                  })
                }
              >
                Primärschlüssel übernehmen
              </button>
            )}
          </div>
          {target.loadingColumns ? (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Spinner className="size-3" />
              Lade Spalten…
            </div>
          ) : (
            <ColumnMultiSelect
              label="Referenzierte Spalten"
              columns={(target.columns ?? []).map((c) => c.name)}
              value={spec.ref_columns}
              onChange={(ref_columns) => patch({ ref_columns })}
            />
          )}
        </div>
      )}

      {(dialect.deleteActions.length > 1 || dialect.updateActions.length > 1) && (
        <div className="grid grid-cols-2 gap-3">
          {actionSelect("ON DELETE", spec.on_delete, dialect.deleteActions, (on_delete) =>
            patch({ on_delete }),
          )}
          {actionSelect("ON UPDATE", spec.on_update, dialect.updateActions, (on_update) =>
            patch({ on_update }),
          )}
        </div>
      )}

      {dialect.deferrable && (
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="fk-deferrable"
              checked={spec.deferrable}
              onCheckedChange={(v) =>
                patch({
                  deferrable: Boolean(v),
                  initially_deferred: Boolean(v) && spec.initially_deferred,
                })
              }
            />
            <Label htmlFor="fk-deferrable" className="text-xs font-normal">
              DEFERRABLE
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="fk-initially-deferred"
              checked={spec.initially_deferred}
              disabled={!spec.deferrable}
              onCheckedChange={(v) => patch({ initially_deferred: Boolean(v) })}
            />
            <Label htmlFor="fk-initially-deferred" className="text-xs font-normal">
              INITIALLY DEFERRED
            </Label>
          </div>
        </div>
      )}
    </div>
  );
}
