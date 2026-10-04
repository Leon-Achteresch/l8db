import { GitBranchPlusIcon, TrashIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { branchTree, isExpired, isProtected } from "@/lib/branching/model";
import { branchingRun } from "@/lib/db";
import { useNow } from "@/lib/hooks/use-now";
import type { BranchPreset } from "./branch-create-dialog";
import { BranchRow } from "./branch-row";
import type { BranchingWorkspace } from "./use-branching";

export function BranchTree({
  workspace,
  onCreate,
  onCompare,
}: {
  workspace: BranchingWorkspace;
  onCreate: (preset: BranchPreset) => void;
  onCompare: (left: string, right: string) => void;
}) {
  const { overview } = workspace;
  const now = useNow();
  if (!overview) return null;
  const rows = branchTree(overview.databases, overview.root);
  const expired = overview.databases.filter(
    (entry) =>
      entry.marker?.branch && !isProtected(entry) && isExpired(entry.marker.branch.expiresAt, now),
  );
  return (
    <section className="space-y-4" aria-label="Branches">
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <BranchRow
            key={row.database.name}
            row={row}
            root={overview.root}
            workspace={workspace}
            onCreate={onCreate}
            onCompare={onCompare}
          />
        ))}
      </ul>
      {rows.length <= 1 && (
        <div className="flex flex-col items-center gap-3 rounded-xl bg-muted/30 px-6 py-8 text-center">
          <GitBranchPlusIcon className="size-6 text-muted-foreground" strokeWidth={1.4} />
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Noch keine Branches</h3>
            <p className="max-w-80 text-xs leading-relaxed text-muted-foreground">
              Ein Branch ist eine eigene Datenbank auf demselben Server: vollständig, nur das Schema
              oder mit anonymisierten Daten. Ideal für Features, Tests und Migrationen.
            </p>
          </div>
          <Button
            size="sm"
            disabled={overview.readOnly}
            onClick={() => onCreate({ source: overview.root, snapshot: null })}
          >
            Ersten Branch erstellen
          </Button>
        </div>
      )}
      {expired.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl bg-muted/30 px-3 py-2.5">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {expired.length === 1
              ? "Ein Branch ist abgelaufen."
              : `${expired.length} Branches sind abgelaufen.`}
          </p>
          <Button
            size="sm"
            variant="ghost"
            disabled={workspace.busy || overview.readOnly}
            onClick={() =>
              void workspace.job(
                "Abgelaufene Branches entfernen",
                (url) => branchingRun(url, { action: "sweep" }, workspace.toolPaths),
                null,
                (job) => {
                  const removed = (job.result?.databases as string[] | undefined)?.length ?? 0;
                  return removed
                    ? `${removed} abgelaufene Branches entfernt.`
                    : "Nichts zu entfernen.";
                },
              )
            }
          >
            <TrashIcon className="size-3.5" />
            Aufräumen
          </Button>
        </div>
      )}
    </section>
  );
}
