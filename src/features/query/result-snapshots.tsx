import { useMemo } from "react";
import { maskQueryResult } from "@/features/query/query-result-masking";
import { useActiveMasks } from "@/lib/masking-display";
import type { ResultRun } from "@/lib/result-compare";
import { ResultSnapshotsDialog } from "./result-snapshots-dialog";

export function ResultSnapshots({
  open,
  onOpenChange,
  run,
  connectionId,
  database,
  onCompare,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: ResultRun | null;
  connectionId: string | null;
  database: string | null;
  onCompare: (run: ResultRun, name: string) => void;
}) {
  const { active } = useActiveMasks(run?.result.columns ?? []);
  const eligible =
    run &&
    !run.result.truncated &&
    run.result.rows.length <= 999 &&
    run.result.columns.length <= 200
      ? run
      : null;
  const masked = useMemo(
    () => (open && eligible ? maskQueryResult(eligible.result, active) : null),
    [open, eligible, active],
  );
  if (!open) return null;
  return (
    <ResultSnapshotsDialog
      open={open}
      onOpenChange={onOpenChange}
      run={eligible && masked ? { ...eligible, result: masked } : null}
      connectionId={connectionId}
      database={database}
      onCompare={onCompare}
    />
  );
}
