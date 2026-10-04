import { ArchiveIcon, CalendarClockIcon, LockKeyholeIcon, PlusIcon, TrashIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/backup";
import { isExpired, relativeTime } from "@/lib/branching/model";
import { branchingLocal, type SnapshotInfo } from "@/lib/db";
import { useNow } from "@/lib/hooks/use-now";
import type { BranchPreset } from "./branch-create-dialog";
import { SnapshotCreateDialog } from "./snapshot-create-dialog";
import { SnapshotRow } from "./snapshot-row";
import type { BranchingWorkspace } from "./use-branching";

export function SnapshotList({
  workspace,
  onCreate,
  onRestore,
  onCompare,
  onPolicies,
}: {
  workspace: BranchingWorkspace;
  onCreate: (preset: BranchPreset) => void;
  onRestore: (snapshot: SnapshotInfo) => void;
  onCompare: (left: string, right: string) => void;
  onPolicies: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const now = useNow();
  const { overview } = workspace;
  if (!overview) return null;
  const expired = overview.snapshots.filter(
    (snapshot) => !snapshot.problem && !snapshot.protected && isExpired(snapshot.expiresAt, now),
  );
  const schedule = overview.policy.schedule;
  const family = new Set(overview.databases.map((entry) => entry.name));
  const groups = new Map<string, SnapshotInfo[]>();
  for (const snapshot of overview.snapshots) {
    const key = snapshot.problem ? "" : snapshot.database;
    groups.set(key, [...(groups.get(key) ?? []), snapshot]);
  }
  const order = [...groups.keys()].sort((a, b) => {
    const rank = (name: string) =>
      name === overview.root ? 0 : !name ? 3 : family.has(name) ? 1 : 2;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  return (
    <section className="space-y-6" aria-label="Sicherungen">
      <div className="flex items-start gap-3 rounded-xl bg-primary/5 p-4">
        <LockKeyholeIcon className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={1.7} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <h3 className="text-sm font-semibold">Verschlüsselter Tresor</h3>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Sicherungen werden lokal mit AES-256-GCM verschlüsselt, signiert und vor jeder Nutzung
            geprüft. Eine Wiederherstellung baut den Stand daneben auf, prüft ihn und tauscht dann
            in einem Schritt – der bisherige Stand bleibt erhalten.
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-[11px]">
            <CalendarClockIcon className="size-3.5 text-muted-foreground" />
            <span>
              {schedule
                ? `Automatisch alle ${schedule.everyHours} Std., behält ${schedule.keep || "alle"}${schedule.lastRunAt ? ` · zuletzt ${relativeTime(schedule.lastRunAt)}` : ""}`
                : "Keine automatische Sicherung"}
            </span>
            <button
              type="button"
              onClick={onPolicies}
              className="text-primary underline-offset-2 hover:underline"
            >
              Zeitplan
            </button>
          </p>
          {schedule?.lastError && (
            <p className="text-[11px] text-destructive">Letzter Lauf: {schedule.lastError}</p>
          )}
        </div>
        <Button
          size="sm"
          className="h-8 shrink-0 gap-1.5 text-xs"
          disabled={!overview.vault.ready || workspace.busy}
          onClick={() => setCreating(true)}
        >
          <PlusIcon className="size-3.5" />
          Sicherung
        </Button>
      </div>
      {order.map((database) => (
        <div key={database || "problem"} className="space-y-1">
          <h4 className="px-1 text-[11px] font-medium text-muted-foreground">
            {database
              ? `${database}${family.has(database) ? "" : " · nicht mehr vorhanden"}`
              : "Beschädigt oder verändert"}
          </h4>
          <ul className="space-y-0.5">
            {(groups.get(database) ?? []).map((snapshot) => (
              <SnapshotRow
                key={snapshot.id}
                snapshot={snapshot}
                exists={family.has(snapshot.database)}
                workspace={workspace}
                onCreate={onCreate}
                onRestore={onRestore}
                onCompare={onCompare}
              />
            ))}
          </ul>
        </div>
      ))}
      {expired.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl bg-muted/30 px-3 py-2.5">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {expired.length === 1
              ? "Eine Sicherung ist abgelaufen."
              : `${expired.length} Sicherungen sind abgelaufen.`}
          </p>
          <Button
            size="sm"
            variant="ghost"
            disabled={workspace.busy}
            onClick={() =>
              void workspace.run(async () => {
                for (const snapshot of expired)
                  await branchingLocal({ action: "delete_snapshot", id: snapshot.id });
              }, "Abgelaufene Sicherungen entfernt.")
            }
          >
            <TrashIcon className="size-3.5" />
            Aufräumen
          </Button>
        </div>
      )}
      {!overview.snapshots.length && (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-muted/30 px-6 py-8 text-center">
          <ArchiveIcon className="size-6 text-muted-foreground" strokeWidth={1.4} />
          <h3 className="text-sm font-semibold">Noch keine Sicherungen</h3>
          <p className="max-w-80 text-xs leading-relaxed text-muted-foreground">
            Eine Sicherung hält einen konsistenten Stand fest – vor Migrationen, Releases oder
            riskanten Änderungen.
          </p>
        </div>
      )}
      {overview.vault.ready && (
        <p className="px-1 text-[11px] text-muted-foreground">
          Tresor: {overview.vault.snapshots} Sicherungen · {formatBytes(overview.vault.bytes)}
        </p>
      )}
      {creating && (
        <SnapshotCreateDialog workspace={workspace} onClose={() => setCreating(false)} />
      )}
    </section>
  );
}
