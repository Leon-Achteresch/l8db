import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type StudioColumn,
  type StudioTableInfo,
  studioTablesAddColumn,
  studioTablesAlterColumn,
  studioTablesDropColumn,
} from "@/lib/db/supabase-studio-tables";
import { SupabaseTableColumnDialog } from "./supabase-table-column-dialog";
import { SupabaseTableConfirmDialog } from "./supabase-table-confirm-dialog";
import { isWritableKind } from "./supabase-tables-utils";

export function SupabaseTableStructure({
  reference,
  info,
  sql,
  onChanged,
}: {
  reference: string;
  info: StudioTableInfo;
  sql: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<{ column: StudioColumn | null } | null>(null);
  const [dropping, setDropping] = useState<StudioColumn | null>(null);
  const editable = sql && isWritableKind(info.kind);

  return (
    <div className="grid min-w-0 gap-4">
      {!sql && (
        <p className="text-xs text-muted-foreground">
          {info.introspected
            ? "Strukturänderungen benötigen SQL-Zugriff (Secret Key selbst gehostet oder Supabase-Zugangstoken)."
            : "Mit diesem Key liefert Supabase keine Spalteninformationen. Strukturänderungen benötigen SQL-Zugriff."}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Spalten</h3>
        {editable && (
          <Button size="sm" variant="outline" onClick={() => setEditing({ column: null })}>
            <Plus className="size-3.5" /> Spalte
          </Button>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-left text-xs">
          <caption className="sr-only">Spalten von {info.name}</caption>
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Name
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Typ
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Standard
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Eigenschaften
              </th>
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">Aktionen</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {info.columns.map((column) => (
              <tr key={column.name} className="border-t">
                <td className="px-3 py-1.5 font-mono">{column.name}</td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground">
                  {column.data_type}
                  {column.enum_values?.length ? ` (${column.enum_values.join(", ")})` : ""}
                </td>
                <td className="max-w-56 truncate px-3 py-1.5 font-mono text-muted-foreground">
                  {column.default_value ?? ""}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex flex-wrap gap-1">
                    {column.is_primary_key && <Badge variant="outline">PK</Badge>}
                    {column.is_unique && <Badge variant="outline">eindeutig</Badge>}
                    {!column.nullable && <Badge variant="outline">NOT NULL</Badge>}
                    {column.is_identity && <Badge variant="outline">Identity</Badge>}
                    {column.is_generated && <Badge variant="outline">generiert</Badge>}
                  </div>
                </td>
                <td className="px-2 py-1 whitespace-nowrap">
                  {editable && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Spalte ${column.name} ändern`}
                        onClick={() => setEditing({ column })}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Spalte ${column.name} löschen`}
                        onClick={() => setDropping(column)}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {info.columns.length === 0 && (
        <p className="text-xs text-muted-foreground">Keine Spalteninformationen verfügbar.</p>
      )}
      {info.introspected && sql && (
        <>
          <h3 className="text-sm font-semibold">Fremdschlüssel</h3>
          {info.foreign_keys.length === 0 ? (
            <p className="text-xs text-muted-foreground">Keine Fremdschlüssel.</p>
          ) : (
            <ul className="grid gap-1 text-xs">
              {info.foreign_keys.map((key) => (
                <li key={key.name} className="rounded-lg border px-3 py-2">
                  <span className="font-mono font-medium">{key.name}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    → {key.foreign_schema}.{key.foreign_table}
                  </span>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {key.definition}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <h3 className="text-sm font-semibold">Indizes</h3>
          {info.indexes.length === 0 ? (
            <p className="text-xs text-muted-foreground">Keine Indizes.</p>
          ) : (
            <ul className="grid gap-1 text-xs">
              {info.indexes.map((index) => (
                <li key={index.name} className="rounded-lg border px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-medium">{index.name}</span>
                    {index.is_primary && <Badge variant="outline">PK</Badge>}
                    {index.is_unique && !index.is_primary && (
                      <Badge variant="outline">eindeutig</Badge>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-[11px] break-all text-muted-foreground">
                    {index.definition}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {editing && (
        <SupabaseTableColumnDialog
          column={editing.column}
          onOpenChange={(open) => !open && setEditing(null)}
          onAdd={async (definition) => {
            await studioTablesAddColumn(reference, info.schema, info.name, definition);
            onChanged();
          }}
          onAlter={async (change) => {
            if (!editing.column) return;
            await studioTablesAlterColumn(
              reference,
              info.schema,
              info.name,
              editing.column.name,
              change,
            );
            onChanged();
          }}
        />
      )}
      <SupabaseTableConfirmDialog
        open={Boolean(dropping)}
        title={`Spalte ${dropping?.name ?? ""} löschen?`}
        description="Die Spalte und alle ihre Werte werden endgültig gelöscht."
        action="Löschen"
        options={[{ id: "cascade", label: "Abhängige Objekte mitlöschen (CASCADE)" }]}
        onOpenChange={(open) => !open && setDropping(null)}
        onConfirm={async (options) => {
          if (!dropping) return;
          await studioTablesDropColumn(
            reference,
            info.schema,
            info.name,
            dropping.name,
            Boolean(options.cascade),
          );
          onChanged();
        }}
      />
    </div>
  );
}
