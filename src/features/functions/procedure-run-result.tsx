import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { QueryResultTable } from "@/features/query/query-result-table";
import { CellValueDialog } from "@/features/table/cell-value-dialog";
import type { DatabaseKind, QueryResult } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function ProcedureRunResult({ result, kind }: { result: QueryResult; kind: DatabaseKind }) {
  const feature = useNewFeatureVisibility<HTMLElement>("procedures.run.results");
  const [inspect, setInspect] = useState<{ column: string; value: unknown } | null>(null);
  return (
    <section
      ref={feature.ref}
      aria-label="Prozedurergebnis"
      className="flex min-h-0 shrink-0 flex-col gap-2"
    >
      <p role="status" className="text-xs font-medium text-success">
        Ausgeführt in {result.execution_time_ms} ms · {result.rows.length}{" "}
        {result.rows.length === 1 ? "Ergebniszeile" : "Ergebniszeilen"}
        {result.truncated ? " · Anzeige begrenzt" : ""}
        {feature.isNew && <NewBadge className="ml-1" />}
      </p>
      <div className="h-64 min-h-0 overflow-hidden">
        <QueryResultTable
          result={result}
          isLoading={false}
          error={null}
          kind={kind}
          onInspect={(column, value) => setInspect({ column, value })}
        />
      </div>
      {inspect && (
        <CellValueDialog
          columnName={inspect.column}
          value={inspect.value}
          canEdit={false}
          isSaving={false}
          onSave={async () => undefined}
          onClose={() => setInspect(null)}
        />
      )}
    </section>
  );
}
