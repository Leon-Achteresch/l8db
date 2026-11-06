import { CameraIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { maskQueryResult } from "@/features/query/query-result-masking";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useActiveMasks } from "@/lib/masking-display";
import type { ResultRun } from "@/lib/result-compare";
import { ResultSnapshotsDialog } from "./result-snapshots-dialog";

export function ResultSnapshotsButton({
  run,
  connectionId,
  database,
  onCompare,
}: {
  run: ResultRun | null;
  connectionId: string | null;
  database: string | null;
  onCompare: (run: ResultRun, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const feature = useNewFeatureVisibility<HTMLButtonElement>("query.results.snapshots");
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
  return (
    <>
      <Button
        ref={feature.ref}
        size="sm"
        variant="ghost"
        className="h-7 gap-1.5 px-2 text-xs"
        onClick={() => setOpen(true)}
      >
        <CameraIcon className="size-3.5" />
        Ergebnisstände{feature.isNew && <NewBadge />}
      </Button>
      {open && (
        <ResultSnapshotsDialog
          open={open}
          onOpenChange={setOpen}
          run={eligible && masked ? { ...eligible, result: masked } : null}
          connectionId={connectionId}
          database={database}
          onCompare={onCompare}
        />
      )}
    </>
  );
}
