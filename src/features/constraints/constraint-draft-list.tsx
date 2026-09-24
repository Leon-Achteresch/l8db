import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CONSTRAINT_KIND_LABEL, describeConstraint } from "@/lib/constraint-designer";
import type { TableConstraintSpec } from "@/lib/db";

interface ConstraintDraftListProps {
  constraints: TableConstraintSpec[];
  columnNames: string[];
  onAdd: () => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
}

export function ConstraintDraftList({
  constraints,
  columnNames,
  onAdd,
  onEdit,
  onRemove,
}: ConstraintDraftListProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Constraints</span>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onAdd}>
          <PlusIcon className="size-3" />
          Constraint hinzufügen
        </Button>
      </div>
      {constraints.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-3 text-[11px] text-muted-foreground">
          Fremdschlüssel, CHECK- und mehrspaltige Unique-Constraints werden hier definiert.
        </p>
      ) : (
        <div className="divide-y rounded-md border">
          {constraints.map((constraint, index) => {
            const missing =
              constraint.kind === "check"
                ? []
                : constraint.columns.filter((column) => !columnNames.includes(column));
            return (
              <div
                key={`${constraint.kind}-${constraint.name ?? ""}-${describeConstraint(constraint)}`}
                className="flex items-start gap-3 px-3 py-2"
              >
                <Badge variant="outline" className="mt-0.5 shrink-0 text-[10px]">
                  {CONSTRAINT_KIND_LABEL[constraint.kind]}
                </Badge>
                <div className="min-w-0 flex-1">
                  {constraint.name && (
                    <div className="font-mono text-xs font-medium">{constraint.name}</div>
                  )}
                  <div className="break-all font-mono text-[11px] text-muted-foreground">
                    {describeConstraint(constraint)}
                  </div>
                  {missing.length > 0 && (
                    <div className="text-[11px] text-destructive">
                      Unbekannte Spalten: {missing.join(", ")}
                    </div>
                  )}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground"
                  aria-label="Constraint bearbeiten"
                  onClick={() => onEdit(index)}
                >
                  <PencilIcon className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  aria-label="Constraint entfernen"
                  onClick={() => onRemove(index)}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
