import {
  ArchiveIcon,
  ClockIcon,
  CopyIcon,
  DatabaseIcon,
  FileDiffIcon,
  GitBranchIcon,
  GitBranchPlusIcon,
  HistoryIcon,
  LoaderCircleIcon,
  LockIcon,
  MoreHorizontalIcon,
  RotateCcwIcon,
  Settings2Icon,
  TrashIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { IconMenu, IconMenuContent, IconMenuItem, IconMenuSeparator } from "@/components/icon-menu";
import { Button } from "@/components/ui/button";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatBytes } from "@/lib/backup";
import {
  branchUrl,
  expiryText,
  isDisposable,
  isExpired,
  isMasked,
  isWorking,
  KIND_LABELS,
  METHOD_LABELS,
  PROTECTION_LABELS,
  relativeTime,
  snapshotsFor,
  type TreeRow,
} from "@/lib/branching/model";
import { branchingRun, branchingSnapshot } from "@/lib/db";
import { cn } from "@/lib/utils";
import { showCopiedMessage } from "@/lib/workspace-status";
import type { BranchPreset } from "./branch-create-dialog";
import { BranchSettingsDialog } from "./branch-settings-dialog";
import { NameConfirmDialog } from "./name-confirm-dialog";
import type { BranchingWorkspace } from "./use-branching";

const INDENT = 20;
const CHIP = "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium";

export function BranchRow({
  row,
  root,
  workspace,
  onCreate,
  onCompare,
}: {
  row: TreeRow;
  root: string;
  workspace: BranchingWorkspace;
  onCreate: (preset: BranchPreset) => void;
  onCompare: (left: string, right: string) => void;
}) {
  const { database, branch, depth, last, guides } = row;
  const [dialog, setDialog] = useState<"delete" | "reset" | "settings" | null>(null);
  const overview = workspace.overview;
  if (!overview) return null;
  const isRoot = database.name === root;
  const active = workspace.database === database.name;
  const working = isWorking(database);
  const disposable = isDisposable(database);
  const protection = database.marker?.protection;
  const locked = Boolean(protection || branch?.protected);
  const expiry = expiryText(branch?.expiresAt);
  const expired = isExpired(branch?.expiresAt);
  const writable = !overview.readOnly && !workspace.busy;
  const owner = database.isOwner || overview.server.superuser;
  const latest = snapshotsFor(overview.snapshots, database.name)[0];
  const Icon = isRoot
    ? DatabaseIcon
    : working
      ? LoaderCircleIcon
      : branch?.kind === "previous"
        ? HistoryIcon
        : GitBranchIcon;
  const meta = isRoot
    ? [
        database.size !== null && formatBytes(database.size),
        `${database.sessions} ${database.sessions === 1 ? "Verbindung" : "Verbindungen"}`,
        `Eigentümer ${database.owner}`,
      ]
    : [
        branch?.kind === "previous"
          ? `Stand vor der Wiederherstellung von ${branch.parent}`
          : `${METHOD_LABELS[branch?.method ?? ""] ?? "Kopie"} von ${branch?.parent}${branch?.sourceName ? ` · Sicherung „${branch.sourceName}“` : ""}`,
        relativeTime(branch?.createdAt),
        branch?.createdBy,
        branch?.resetAt && `zurückgesetzt ${relativeTime(branch.resetAt)}`,
        database.size !== null && formatBytes(database.size),
      ];
  const copyUrl = async () => {
    const url = branchUrl(workspace.connection.connectionString, database.name);
    if (!url) {
      toast.error("Für diese Verbindung lässt sich keine URL ableiten.");
      return;
    }
    await navigator.clipboard.writeText(url);
    showCopiedMessage("Verbindungs-URL ohne Passwort kopiert.");
  };
  const snapshot = () =>
    void workspace.job(
      `Sicherung von „${database.name}“`,
      (url) => branchingSnapshot(url, { database: database.name }, workspace.toolPaths),
      database.name,
      () => `Sicherung von „${database.name}“ erstellt.`,
    );
  return (
    <li className="relative">
      {guides.map((on, column) =>
        column > 0 && on ? (
          <span
            key={column}
            aria-hidden
            className="absolute inset-y-0 w-px bg-border"
            style={{ left: column * INDENT - INDENT / 2 + 8 }}
          />
        ) : null,
      )}
      {depth > 0 && (
        <>
          <span
            aria-hidden
            className="absolute top-0 w-px bg-border"
            style={{ left: depth * INDENT - INDENT / 2 + 8, height: last ? "1.375rem" : "100%" }}
          />
          <span
            aria-hidden
            className="absolute h-px bg-border"
            style={{ left: depth * INDENT - INDENT / 2 + 8, top: "1.375rem", width: INDENT / 2 }}
          />
        </>
      )}
      <div
        className={cn(
          "group flex items-start gap-2.5 rounded-xl py-2 pr-1.5 transition-colors hover:bg-muted/40",
          active && "bg-primary/5 hover:bg-primary/10",
        )}
        style={{ paddingLeft: depth * INDENT + 8 }}
      >
        <span
          className={cn(
            "relative flex size-7 shrink-0 items-center justify-center rounded-lg",
            isRoot ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className={cn("size-3.5", working && "animate-spin")} strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-mono text-xs font-medium">{database.name}</span>
            {isRoot && (
              <span className={cn(CHIP, "bg-muted text-muted-foreground")}>Hauptstand</span>
            )}
            {branch && branch.kind !== "previous" && (
              <span
                className={cn(
                  CHIP,
                  branch.kind === "anonymized"
                    ? "bg-violet-500/10 text-violet-700 dark:text-violet-300"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {working ? "Wird angelegt" : (KIND_LABELS[branch.kind] ?? branch.kind)}
              </span>
            )}
            {locked && (
              <span className={cn(CHIP, "bg-amber-500/10 text-amber-700 dark:text-amber-300")}>
                <LockIcon className="size-2.5" />
                {protection ? PROTECTION_LABELS[protection] : "Geschützt"}
              </span>
            )}
            {expiry && (
              <span
                className={cn(
                  CHIP,
                  expired ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
                )}
              >
                <ClockIcon className="size-2.5" />
                {expiry}
              </span>
            )}
            {active && <span className={cn(CHIP, "bg-primary/10 text-primary")}>Aktiv</span>}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {meta.filter(Boolean).join(" · ")}
          </p>
        </div>
        {!active && !working && database.canConnect && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => workspace.openDatabase(database.name)}
          >
            Öffnen
          </Button>
        )}
        <IconMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Aktionen für ${database.name}`}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreHorizontalIcon className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <IconMenuContent>
            {!disposable && !working && (
              <IconMenuItem
                icon={<GitBranchPlusIcon />}
                label="Branch davon erstellen"
                disabled={!writable}
                onSelect={() => onCreate({ source: database.name, snapshot: null })}
              />
            )}
            {!disposable && !working && (
              <IconMenuItem
                icon={<ArchiveIcon />}
                label="Sicherung erstellen"
                disabled={workspace.busy || isMasked(database) || !overview.vault.ready}
                onSelect={snapshot}
              />
            )}
            {!isRoot && (
              <IconMenuItem
                icon={<FileDiffIcon />}
                label={`Schema mit ${branch?.parent ?? root} vergleichen`}
                onSelect={() =>
                  onCompare(`live:${branch?.parent ?? root}`, `live:${database.name}`)
                }
              />
            )}
            {isRoot && latest && (
              <IconMenuItem
                icon={<FileDiffIcon />}
                label="Mit letzter Sicherung vergleichen"
                onSelect={() => onCompare(`snapshot:${latest.id}`, `live:${database.name}`)}
              />
            )}
            <IconMenuItem
              icon={<CopyIcon />}
              label="Verbindungs-URL kopieren"
              onSelect={() => void copyUrl()}
            />
            {branch && !disposable && !working && (
              <>
                <IconMenuSeparator />
                <IconMenuItem
                  icon={<RotateCcwIcon />}
                  label="Auf Ursprung zurücksetzen…"
                  disabled={!writable || !owner}
                  onSelect={() => setDialog("reset")}
                />
                <IconMenuItem
                  icon={<Settings2Icon />}
                  label="Einstellungen…"
                  disabled={!writable || !owner}
                  onSelect={() => setDialog("settings")}
                />
              </>
            )}
            {branch && (
              <IconMenuItem
                icon={<TrashIcon />}
                label="Löschen…"
                disabled={!writable || !owner}
                variant="destructive"
                onSelect={() => setDialog("delete")}
              />
            )}
          </IconMenuContent>
        </IconMenu>
      </div>
      {dialog === "delete" && (
        <NameConfirmDialog
          title={`„${database.name}“ löschen?`}
          description={
            database.sessions > 0
              ? `Die Datenbank wird mit allen Daten entfernt. ${database.sessions} offene Verbindungen werden getrennt.`
              : "Die Datenbank wird mit allen Daten entfernt."
          }
          name={database.name}
          requireName={locked || database.sessions > 0}
          action="Endgültig löschen"
          destructive
          onClose={() => setDialog(null)}
          onConfirm={(confirm) =>
            void workspace
              .job(
                `„${database.name}“ löschen`,
                (url) =>
                  branchingRun(
                    url,
                    { action: "delete", name: database.name, confirm },
                    workspace.toolPaths,
                  ),
                database.name,
                () => `„${database.name}“ gelöscht.`,
              )
              .then((job) => {
                if (job && active) workspace.openDatabase(branch?.parent ?? root);
              })
          }
        />
      )}
      {dialog === "reset" && branch && (
        <NameConfirmDialog
          title={`„${database.name}“ zurücksetzen?`}
          description={
            branch.source
              ? `Alle Änderungen gehen verloren. Der Branch wird neu aus der Sicherung „${branch.sourceName ?? branch.source}“ aufgebaut, Rechte und Einstellungen bleiben erhalten.`
              : `Alle Änderungen gehen verloren. Der Branch übernimmt den aktuellen Stand von „${branch.parent}“, Rechte und Einstellungen bleiben erhalten.`
          }
          name={database.name}
          requireName={locked}
          action="Zurücksetzen"
          destructive
          onClose={() => setDialog(null)}
          onConfirm={(confirm) =>
            void workspace.job(
              `„${database.name}“ zurücksetzen`,
              (url) =>
                branchingRun(
                  url,
                  { action: "reset", name: database.name, confirm },
                  workspace.toolPaths,
                ),
              database.name,
              () => `„${database.name}“ wurde zurückgesetzt.`,
            )
          }
        />
      )}
      {dialog === "settings" && branch && (
        <BranchSettingsDialog
          workspace={workspace}
          database={database}
          branch={branch}
          onClose={() => setDialog(null)}
        />
      )}
    </li>
  );
}
