import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CONSTRAINT_KIND_LABEL, type ConstraintKind } from "@/lib/constraint-designer";
import type { TableConstraintSpec } from "@/lib/db";

type Tab = ConstraintKind | "options";

interface CreateTableConstraintsProps {
  supported: boolean;
  constraints: TableConstraintSpec[];
  columnNames: string[];
  hasPrimaryKeyColumn: boolean;
  primaryKeyName: string;
  primaryKeyPlaceholder: string;
  templateNotes: string[];
  onPrimaryKeyNameChange: (value: string) => void;
  onAdd: (kind: ConstraintKind) => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
}

function constraintColumns(spec: TableConstraintSpec): string {
  return spec.kind === "check" ? spec.expression.trim() : spec.columns.join(", ");
}

export function CreateTableConstraints({
  supported,
  constraints,
  columnNames,
  hasPrimaryKeyColumn,
  primaryKeyName,
  primaryKeyPlaceholder,
  templateNotes,
  onPrimaryKeyNameChange,
  onAdd,
  onEdit,
  onRemove,
}: CreateTableConstraintsProps) {
  const kinds: ConstraintKind[] = supported
    ? [
        "foreign_key",
        "check",
        "unique",
        ...(hasPrimaryKeyColumn && !constraints.some((c) => c.kind === "primary_key")
          ? []
          : (["primary_key"] as ConstraintKind[])),
      ]
    : [];
  const [tab, setTab] = useState<Tab>(supported ? "foreign_key" : "options");
  const active: Tab = tab === "options" || kinds.includes(tab) ? tab : (kinds[0] ?? "options");
  const indexed = constraints.map((spec, index) => ({ spec, index }));

  return (
    <Tabs
      value={active}
      onValueChange={(value) => setTab(value as Tab)}
      className="flex max-h-[40%] min-h-0 shrink-0 flex-col gap-0 border-t"
    >
      <div className="flex h-9 shrink-0 items-center border-b px-2">
        <TabsList variant="line" className="h-9">
          {kinds.map((kind) => {
            const count = constraints.filter((c) => c.kind === kind).length;
            return (
              <TabsTrigger key={kind} value={kind} className="text-xs">
                {kind === "check" ? "Checks" : CONSTRAINT_KIND_LABEL[kind]}
                {count > 0 && (
                  <span className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground tabular-nums">
                    {count}
                  </span>
                )}
              </TabsTrigger>
            );
          })}
          <TabsTrigger value="options" className="text-xs">
            Optionen
          </TabsTrigger>
        </TabsList>
        {active !== "options" && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 text-xs"
            onClick={() => onAdd(active)}
          >
            <PlusIcon className="size-3.5" />
            {active === "check" ? "Check" : CONSTRAINT_KIND_LABEL[active]}
          </Button>
        )}
      </div>
      {kinds.map((kind) => {
        const rows = indexed.filter(({ spec }) => spec.kind === kind);
        return (
          <TabsContent key={kind} value={kind} className="min-h-0 overflow-auto">
            {rows.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                Keine {kind === "check" ? "Checks" : CONSTRAINT_KIND_LABEL[kind]}-Einträge
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr className="h-8 border-b">
                    <th className="px-3 font-medium">Name</th>
                    <th className="px-3 font-medium">
                      {kind === "check" ? "Ausdruck" : "Spalten"}
                    </th>
                    {kind === "foreign_key" && (
                      <>
                        <th className="px-3 font-medium">Referenz</th>
                        <th className="px-3 font-medium">Beim Löschen</th>
                        <th className="px-3 font-medium">Beim Ändern</th>
                      </>
                    )}
                    <th className="w-16" />
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {rows.map(({ spec, index }) => {
                    const missing =
                      spec.kind === "check"
                        ? []
                        : spec.columns.filter((column) => !columnNames.includes(column));
                    return (
                      <tr
                        key={index}
                        className="group h-8 border-b last:border-b-0 hover:bg-muted/30"
                      >
                        <td className="px-3">
                          {spec.name || <span className="text-muted-foreground">automatisch</span>}
                        </td>
                        <td className="px-3">
                          {constraintColumns(spec)}
                          {missing.length > 0 && (
                            <span className="ml-2 font-sans text-destructive">
                              Unbekannt: {missing.join(", ")}
                            </span>
                          )}
                        </td>
                        {spec.kind === "foreign_key" && (
                          <>
                            <td className="px-3 text-primary">
                              {spec.ref_schema ? `${spec.ref_schema}.` : ""}
                              {spec.ref_table}.{spec.ref_columns.join(", ")}
                            </td>
                            <td className="px-3 lowercase">{spec.on_delete ?? "no action"}</td>
                            <td className="px-3 lowercase">{spec.on_update ?? "no action"}</td>
                          </>
                        )}
                        <td className="pr-1 text-right whitespace-nowrap">
                          <IconButton
                            size="icon-xs"
                            variant="ghost"
                            className="text-muted-foreground"
                            aria-label="Constraint bearbeiten"
                            onClick={() => onEdit(index)}
                          >
                            <PencilIcon />
                          </IconButton>
                          <IconButton
                            size="icon-xs"
                            variant="ghost"
                            className="text-muted-foreground hover:text-destructive"
                            aria-label="Constraint entfernen"
                            onClick={() => onRemove(index)}
                          >
                            <Trash2Icon />
                          </IconButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </TabsContent>
        );
      })}
      <TabsContent value="options" className="min-h-0 space-y-3 overflow-auto px-3 py-3 text-xs">
        {supported && hasPrimaryKeyColumn && (
          <div className="flex items-center gap-3">
            <label htmlFor="create-table-pk-name" className="w-36 text-muted-foreground">
              Name des Primärschlüssels
            </label>
            <Input
              id="create-table-pk-name"
              value={primaryKeyName}
              onChange={(e) => onPrimaryKeyNameChange(e.target.value)}
              placeholder={primaryKeyPlaceholder}
              className="h-7 w-56 font-mono text-xs"
            />
          </div>
        )}
        {templateNotes.length > 0 && (
          <div className="space-y-1">
            <div className="text-muted-foreground">Hinweise zur Vorlage</div>
            <ul className="list-disc space-y-0.5 pl-4">
              {templateNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        )}
        {!(supported && hasPrimaryKeyColumn) && templateNotes.length === 0 && (
          <p className="text-muted-foreground">Keine weiteren Optionen</p>
        )}
      </TabsContent>
    </Tabs>
  );
}
