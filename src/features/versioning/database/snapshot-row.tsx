import {
  ArchiveIcon,
  CalendarClockIcon,
  ClockIcon,
  FileDiffIcon,
  GitBranchPlusIcon,
  LockIcon,
  MoreHorizontalIcon,
  PencilIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  TrashIcon,
  Undo2Icon,
} from "lucide-react";
import { useState } from "react";
import { IconMenu, IconMenuContent, IconMenuItem, IconMenuSeparator } from "@/components/icon-menu";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatBytes } from "@/lib/backup";
import { expiryText, isExpired, relativeTime } from "@/lib/branching/model";
import { branchingLocal, branchingVerify, type SnapshotInfo } from "@/lib/db";
import { cn } from "@/lib/utils";
import type { BranchPreset } from "./branch-create-dialog";
import { NameConfirmDialog } from "./name-confirm-dialog";
import { SnapshotEditDialog } from "./snapshot-edit-dialog";
import type { BranchingWorkspace } from "./use-branching";

const CHIP = "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium";

export function SnapshotRow({
  snapshot,
  exists,
  workspace,
  onCreate,
  onRestore,
  onCompare,
}: {
  snapshot: SnapshotInfo;
  exists: boolean;
  workspace: BranchingWorkspace;
  onCreate: (preset: BranchPreset) => void;
  onRestore: (snapshot: SnapshotInfo) => void;
  onCompare: (left: string, right: string) => void;
}) {
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const overview = workspace.overview;
  if (!overview) return null;
  const writable = !overview.readOnly && !workspace.busy;
  const damaged = Boolean(snapshot.problem);
  const scheduled = snapshot.trigger === "schedule";
  const expiry = expiryText(snapshot.expiresAt);
  const created = new Date(snapshot.createdAt);
  const author = snapshot.createdBy
    ? `${snapshot.createdBy.osUser}@${snapshot.createdBy.host}`
    : null;
  const Icon = damaged ? ShieldAlertIcon : scheduled ? CalendarClockIcon : ArchiveIcon;
  const meta = damaged
    ? [snapshot.problem]
    : [
        relativeTime(snapshot.createdAt),
        author,
        `${snapshot.tables} ${snapshot.tables === 1 ? "Tabelle" : "Tabellen"}`,
        `${snapshot.rows.toLocaleString("de-DE")} Zeilen`,
        `${formatBytes(snapshot.plainBytes)} → ${formatBytes(snapshot.bytes)} verschlüsselt`,
      ];
  const verify = () =>
    void workspace.job(
      `Sicherung „${snapshot.label}“ prüfen`,
      () => branchingVerify(snapshot.id),
      snapshot.database,
      () => `„${snapshot.label}“ ist vollständig und unverändert.`,
    );
  return (
    <li className="group flex items-start gap-2.5 rounded-xl px-2 py-2 transition-colors hover:bg-muted/40">
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg",
          damaged ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-3.5" strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className="truncate text-xs font-medium"
            title={damaged ? snapshot.id : created.toLocaleString("de-DE")}
          >
            {damaged ? snapshot.id : snapshot.label}
          </span>
          {scheduled && (
            <span className={cn(CHIP, "bg-muted text-muted-foreground")}>Automatisch</span>
          )}
          {snapshot.protected && (
            <span className={cn(CHIP, "bg-amber-500/10 text-amber-700 dark:text-amber-300")}>
              <LockIcon className="size-2.5" />
              Geschützt
            </span>
          )}
          {expiry && (
            <span
              className={cn(
                CHIP,
                isExpired(snapshot.expiresAt)
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <ClockIcon className="size-2.5" />
              {expiry}
            </span>
          )}
        </div>
        <p
          className={cn(
            "mt-0.5 text-[11px]",
            damaged ? "break-words text-destructive" : "truncate text-muted-foreground",
          )}
        >
          {meta.filter(Boolean).join(" · ")}
        </p>
        {snapshot.note && (
          <p className="mt-1 line-clamp-2 whitespace-pre-line text-[11px] text-muted-foreground/80">
            {snapshot.note}
          </p>
        )}
      </div>
      <IconMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Aktionen für ${damaged ? snapshot.id : snapshot.label}`}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MoreHorizontalIcon className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <IconMenuContent>
          {!damaged && (
            <>
              <IconMenuItem
                icon={<Undo2Icon />}
                label={
                  exists
                    ? `„${snapshot.database}“ wiederherstellen…`
                    : "Datenbank existiert nicht mehr"
                }
                disabled={!writable || !exists}
                onSelect={() => onRestore(snapshot)}
              />
              <IconMenuItem
                icon={<GitBranchPlusIcon />}
                label="Als Branch öffnen…"
                disabled={!writable}
                onSelect={() => onCreate({ source: snapshot.database, snapshot: snapshot.id })}
              />
              <IconMenuItem
                icon={<FileDiffIcon />}
                label="Schema mit aktuellem Stand vergleichen"
                onSelect={() =>
                  onCompare(
                    `snapshot:${snapshot.id}`,
                    `live:${exists ? snapshot.database : overview.root}`,
                  )
                }
              />
              <IconMenuItem
                icon={<ShieldCheckIcon />}
                label="Integrität prüfen"
                disabled={workspace.busy}
                onSelect={verify}
              />
              <IconMenuSeparator />
              <IconMenuItem
                icon={<PencilIcon />}
                label="Bearbeiten…"
                disabled={workspace.busy}
                onSelect={() => setDialog("edit")}
              />
            </>
          )}
          <IconMenuItem
            icon={<TrashIcon />}
            label={snapshot.protected ? "Geschützt – nicht löschbar" : "Löschen…"}
            disabled={workspace.busy || snapshot.protected}
            variant="destructive"
            onSelect={() => setDialog("delete")}
          />
        </IconMenuContent>
      </IconMenu>
      {dialog === "edit" && (
        <SnapshotEditDialog
          workspace={workspace}
          snapshot={snapshot}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "delete" && (
        <NameConfirmDialog
          title={damaged ? "Beschädigte Sicherung löschen?" : `„${snapshot.label}“ löschen?`}
          description="Die verschlüsselten Dateien werden aus dem Tresor entfernt. Das lässt sich nicht rückgängig machen; der Vorgang wird protokolliert."
          name={snapshot.id}
          requireName={false}
          action="Endgültig löschen"
          destructive
          onClose={() => setDialog(null)}
          onConfirm={() =>
            void workspace.run(
              () => branchingLocal({ action: "delete_snapshot", id: snapshot.id }),
              "Sicherung gelöscht.",
            )
          }
        />
      )}
    </li>
  );
}
