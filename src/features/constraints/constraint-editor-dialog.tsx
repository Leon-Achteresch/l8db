import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ColumnMultiSelect } from "@/features/constraints/column-multi-select";
import { ForeignKeyFields } from "@/features/constraints/foreign-key-fields";
import { useForeignKeyTarget } from "@/features/constraints/use-foreign-key-target";
import {
  CONSTRAINT_KIND_LABEL,
  type ColumnRef,
  type ConstraintKind,
  constraintDialectInfo,
  constraintIssues,
  emptyConstraint,
  suggestedConstraintName,
} from "@/lib/constraint-designer";
import type { DatabaseKind, TableConstraintSpec } from "@/lib/db";
import { useActiveCapabilities } from "@/lib/db-selection";

const SqlEditor = lazy(() =>
  import("@/features/table/sql-editor").then((module) => ({ default: module.SqlEditor })),
);

interface ConstraintEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: DatabaseKind;
  schema: string;
  table: string;
  columns: ColumnRef[];
  initial: TableConstraintSpec | null;
  allowedKinds: ConstraintKind[];
  isNewTable: boolean;
  submitLabel: string;
  preview?: (spec: TableConstraintSpec) => Promise<string>;
  onSubmit: (spec: TableConstraintSpec) => Promise<boolean> | boolean;
}

function withDefaults(spec: TableConstraintSpec, schema: string): TableConstraintSpec {
  return spec.kind === "foreign_key" && spec.ref_schema === null
    ? { ...spec, ref_schema: schema || null }
    : spec;
}

export function ConstraintEditorDialog({
  open,
  onOpenChange,
  kind,
  schema,
  table,
  columns,
  initial,
  allowedKinds,
  isNewTable,
  submitLabel,
  preview,
  onSubmit,
}: ConstraintEditorDialogProps) {
  const capabilities = useActiveCapabilities();
  const dialect = constraintDialectInfo(kind);
  const [spec, setSpec] = useState<TableConstraintSpec>(() =>
    withDefaults(initial ?? emptyConstraint(allowedKinds[0] ?? "foreign_key"), schema),
  );
  const [previewSql, setPreviewSql] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fk = spec.kind === "foreign_key" ? spec : null;
  const target = useForeignKeyTarget({
    schema: fk?.ref_schema ?? schema,
    table: fk?.ref_table ?? "",
    self: isNewTable ? { schema, name: table, columns } : null,
  });

  const issues = useMemo(
    () => constraintIssues(spec, columns, fk ? target.columns : null),
    [spec, columns, fk, target.columns],
  );

  useEffect(() => {
    if (!open || !preview) return;
    if (issues.length > 0) {
      setPreviewSql("");
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      preview(spec)
        .then((sql) => {
          if (cancelled) return;
          setPreviewSql(sql);
          setPreviewError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setPreviewSql("");
          setPreviewError(typeof err === "string" ? err : String(err));
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, preview, spec, issues.length]);

  if (!dialect) return null;

  const changeKind = (next: string) => {
    const nextKind = next as ConstraintKind;
    if (nextKind === spec.kind) return;
    setSpec(withDefaults({ ...emptyConstraint(nextKind), name: spec.name }, schema));
  };

  const handleSubmit = async () => {
    if (issues.length > 0 || submitting) return;
    setSubmitting(true);
    try {
      const trimmedName = spec.name?.trim() || null;
      if (await onSubmit({ ...spec, name: trimmedName })) onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const columnNames = columns.map((c) => c.name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {initial ? "Constraint bearbeiten" : "Constraint hinzufügen"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {schema ? `${schema}.` : ""}
            {table || "neue Tabelle"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!initial && allowedKinds.length > 1 && (
            <Tabs value={spec.kind} onValueChange={changeKind}>
              <TabsList className="w-full">
                {allowedKinds.map((k) => (
                  <TabsTrigger key={k} value={k} className="text-xs">
                    {CONSTRAINT_KIND_LABEL[k]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="constraint-name" className="text-xs">
              Name
            </Label>
            <Input
              id="constraint-name"
              value={spec.name ?? ""}
              onChange={(e) => setSpec({ ...spec, name: e.target.value })}
              placeholder={suggestedConstraintName(table, spec)}
              className="h-8 font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Leer lassen, damit die Datenbank einen Namen vergibt.
            </p>
          </div>

          {spec.kind === "foreign_key" && (
            <ForeignKeyFields
              spec={spec}
              onChange={setSpec}
              localColumns={columns}
              dialect={dialect}
              showSchema={capabilities.schemas && kind !== "sqlite"}
              target={target}
            />
          )}

          {(spec.kind === "unique" || spec.kind === "primary_key") && (
            <div className="space-y-1.5">
              <Label className="text-xs">Spalten (Reihenfolge = Klickreihenfolge)</Label>
              <ColumnMultiSelect
                label="Spalten"
                columns={columnNames}
                value={spec.columns}
                onChange={(next) => setSpec({ ...spec, columns: next })}
              />
            </div>
          )}

          {spec.kind === "check" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Ausdruck</Label>
              <Suspense
                fallback={
                  <div className="flex h-24 items-center justify-center rounded-md border">
                    <Spinner />
                  </div>
                }
              >
                <SqlEditor
                  value={spec.expression}
                  onChange={(expression) =>
                    setSpec((current) =>
                      current.kind === "check" ? { ...current, expression } : current,
                    )
                  }
                  onSubmit={() => void handleSubmit()}
                  columns={columnNames}
                  placeholder="z. B.  price > 0 AND status IN ('neu', 'aktiv')"
                  className="h-24"
                />
              </Suspense>
            </div>
          )}

          {dialect.createNote && isNewTable && (
            <p className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
              {dialect.createNote}
            </p>
          )}

          {issues.length > 0 && (
            <ul className="list-disc space-y-0.5 rounded-md border border-destructive/30 bg-destructive/5 px-5 py-2 text-[11px] text-destructive">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}

          {preview && (previewSql || previewError) && (
            <div className="space-y-1.5">
              <Label className="text-xs">SQL-Vorschau</Label>
              {previewSql ? (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-2 font-mono text-[11px]">
                  {previewSql}
                </pre>
              ) : (
                <p className="text-[11px] text-destructive">{previewError}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            size="sm"
            disabled={issues.length > 0 || submitting || (Boolean(preview) && !previewSql)}
            onClick={() => void handleSubmit()}
          >
            {submitting && <Spinner className="size-3.5" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
