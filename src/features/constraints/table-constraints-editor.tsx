import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon, TrashIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
import { Spinner } from "@/components/ui/spinner";
import { ConstraintEditorDialog } from "@/features/constraints/constraint-editor-dialog";
import { constraintTypeColor } from "@/features/table/table-constraints-list/constraint-type-icon";
import { useActiveConnection } from "@/lib/connections";
import { type ColumnRef, constraintDialectInfo } from "@/lib/constraint-designer";
import {
  applyConstraintChange,
  type ConstraintChange,
  type ConstraintInfo,
  previewConstraintChange,
  type TableConstraintSpec,
} from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { useConstraintsQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";

interface TableConstraintsEditorProps {
  schema: string;
  table: string;
  columns: ColumnRef[];
}

export function TableConstraintsEditor({ schema, table, columns }: TableConstraintsEditorProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const { data: constraints, isLoading } = useConstraintsQuery(schema, table);
  const [dialogKey, setDialogKey] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<ConstraintInfo | null>(null);
  const [dropSql, setDropSql] = useState("");
  const [dropError, setDropError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);

  const kind = connection?.kind;
  const dialect = constraintDialectInfo(kind);

  useEffect(() => {
    if (!dropTarget || !kind) return;
    let cancelled = false;
    setDropSql("");
    setDropError(null);
    previewConstraintChange(kind, schema, table, {
      action: "drop",
      name: dropTarget.name,
      constraint_type: dropTarget.constraint_type,
    })
      .then((sql) => {
        if (!cancelled) setDropSql(sql);
      })
      .catch((err) => {
        if (!cancelled) setDropError(typeof err === "string" ? err : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [dropTarget, kind, schema, table]);

  const preview = useCallback(
    (spec: TableConstraintSpec) =>
      kind
        ? previewConstraintChange(kind, schema, table, { action: "add", constraint: spec })
        : Promise.reject(new Error("Keine Verbindung aktiv.")),
    [kind, schema, table],
  );

  if (!connection || !kind || !dialect) return null;

  const refresh = async () => {
    await Promise.all(
      ["constraints", "foreign-keys", "columns-detailed", "table-columns-detailed"].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key, connection.id] }),
      ),
    );
  };

  const apply = async (change: ConstraintChange, success: string) => {
    try {
      await applyConstraintChange(
        kind,
        effectiveConnectionString(connection),
        schema,
        table,
        change,
        database ?? undefined,
      );
      toast.success(success);
      await refresh();
      return true;
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
      return false;
    }
  };

  const hasPrimaryKey = (constraints ?? []).some(
    (c) => c.constraint_type.toUpperCase() === "PRIMARY KEY",
  );

  const handleDrop = async () => {
    if (!dropTarget) return;
    setDropping(true);
    const ok = await apply(
      { action: "drop", name: dropTarget.name, constraint_type: dropTarget.constraint_type },
      `Constraint "${dropTarget.name}" entfernt.`,
    );
    setDropping(false);
    if (ok) setDropTarget(null);
  };

  return (
    <div className="border-t">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Constraints</span>
          <Badge variant="outline" className="text-xs">
            {constraints?.length ?? 0}
          </Badge>
        </div>
        {dialect.alter && (
          <Button variant="outline" size="xs" onClick={() => setDialogKey(Date.now())}>
            <PlusIcon data-icon="inline-start" />
            Constraint hinzufügen
          </Button>
        )}
      </div>

      {dialect.alterNote && (
        <p className="border-b bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
          {dialect.alterNote}
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
          <Spinner className="size-3.5" />
          Lade Constraints…
        </div>
      ) : (constraints ?? []).length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">Keine Constraints vorhanden.</p>
      ) : (
        <div className="divide-y">
          {(constraints ?? []).map((constraint) => (
            <div
              key={`${constraint.constraint_type}-${constraint.name}`}
              className="group flex items-start gap-3 px-4 py-2"
            >
              <Badge
                variant="outline"
                className={`mt-0.5 shrink-0 text-[10px] ${constraintTypeColor(constraint.constraint_type)}`}
              >
                {constraint.constraint_type}
              </Badge>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs font-medium">{constraint.name}</div>
                <div className="break-all font-mono text-[11px] text-muted-foreground">
                  {constraint.definition}
                </div>
              </div>
              {dialect.alter && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-destructive opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
                  aria-label={`Constraint ${constraint.name} entfernen`}
                  onClick={() => setDropTarget(constraint)}
                >
                  <TrashIcon className="size-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {dialogKey !== null && (
        <ConstraintEditorDialog
          key={dialogKey}
          open
          onOpenChange={(open) => {
            if (!open) setDialogKey(null);
          }}
          kind={kind}
          schema={schema}
          table={table}
          columns={columns}
          initial={null}
          allowedKinds={
            hasPrimaryKey
              ? ["foreign_key", "check", "unique"]
              : ["foreign_key", "check", "unique", "primary_key"]
          }
          isNewTable={false}
          submitLabel="Ausführen"
          preview={preview}
          onSubmit={(spec) => apply({ action: "add", constraint: spec }, "Constraint hinzugefügt.")}
        />
      )}

      <AlertDialog
        open={dropTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDropTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Constraint &quot;{dropTarget?.name}&quot; entfernen?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {dropSql ? (
                  <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-2 font-mono text-[11px] text-foreground">
                    {dropSql}
                  </pre>
                ) : dropError ? (
                  <span className="text-destructive">{dropError}</span>
                ) : (
                  <Spinner className="size-3.5" />
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dropping}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDrop();
              }}
              disabled={dropping || !dropSql}
            >
              {dropping ? <Spinner className="size-4" /> : null}
              Entfernen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
