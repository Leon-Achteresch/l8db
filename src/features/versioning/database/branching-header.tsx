import {
  CircleAlertIcon,
  DatabaseIcon,
  KeyRoundIcon,
  PlusIcon,
  RefreshCwIcon,
  ZapIcon,
} from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { PROTECTION_LABELS } from "@/lib/branching/model";
import { useHasNewFeatures } from "@/lib/new-features";
import { VersioningIconButton } from "../versioning-icon-button";
import type { BranchPreset } from "./branch-create-dialog";
import { BranchingJobs } from "./branching-jobs";
import type { BranchingWorkspace } from "./use-branching";

export function BranchingHeader({
  workspace,
  onCreate,
}: {
  workspace: BranchingWorkspace;
  onCreate: (preset: BranchPreset) => void;
}) {
  const { overview, busy, loading } = workspace;
  const anonymizedNew = useHasNewFeatures("versioning.database.anonymized");
  const root = overview?.databases.find((entry) => entry.name === overview.root);
  const protection = root?.marker?.protection;
  const warnings = [
    overview?.readOnly &&
      "Diese Verbindung ist schreibgeschützt. Sicherungen und Vergleiche sind möglich, Branches und Wiederherstellungen nicht.",
    overview?.tools.problem,
    overview && !overview.vault.ready && `Tresor nicht verfügbar: ${overview.vault.problem}`,
    overview &&
      !overview.server.createDb &&
      !overview.server.superuser &&
      `Die Rolle „${overview.server.user}“ darf keine Datenbanken anlegen (CREATEDB).`,
  ].filter((entry): entry is string => Boolean(entry));
  return (
    <div className="shrink-0 space-y-3 px-5 pb-4 pt-1">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <DatabaseIcon className="size-4" strokeWidth={1.7} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 truncate text-base font-semibold tracking-tight">
            <span className="truncate">{overview?.root ?? workspace.database}</span>
            {protection && (
              <span
                className={
                  protection === "masked"
                    ? "rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300"
                    : "rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
                }
              >
                {PROTECTION_LABELS[protection]}
              </span>
            )}
          </h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>
              {overview
                ? `PostgreSQL ${overview.server.version.split(" ")[0]} · ${overview.server.user}`
                : workspace.connection.name}
            </span>
            {overview?.server.instantClone && (
              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                <ZapIcon className="size-3" />
                Sofort-Klon
              </span>
            )}
            {overview?.vault.fingerprint && (
              <span
                className="inline-flex items-center gap-1 font-mono"
                title="Fingerabdruck des Tresor-Schlüssels"
              >
                <KeyRoundIcon className="size-3" />
                {overview.vault.fingerprint}
              </span>
            )}
          </p>
        </div>
        <VersioningIconButton
          icon={RefreshCwIcon}
          label="Branches aktualisieren"
          disabled={busy}
          className={loading ? "animate-pulse" : ""}
          onClick={() => void workspace.refresh()}
        />
        <Button
          size="sm"
          disabled={!overview || overview.readOnly || busy}
          onClick={() => onCreate({ source: workspace.database, snapshot: null })}
        >
          <PlusIcon className="size-3.5" />
          Branch
          {anonymizedNew && <NewBadge />}
        </Button>
      </div>
      {warnings.map((warning) => (
        <p
          key={warning}
          className="flex gap-2 rounded-lg bg-amber-500/5 p-2.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200"
        >
          <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{warning}</span>
        </p>
      ))}
      <BranchingJobs jobs={workspace.jobs} />
    </div>
  );
}
