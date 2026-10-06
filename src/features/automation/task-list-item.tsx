import {
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  PlayIcon,
  SquareTerminalIcon,
  Trash2Icon,
} from "lucide-react";
import type { MouseEvent } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRelative, runStatusLabel } from "@/lib/automation/format";
import { useAutomationStore } from "@/lib/automation/store";
import type { TaskSummary } from "@/lib/db/automation";
import { cn } from "@/lib/utils";
import { AiFlash } from "./ai-flash";
import { StatusIcon } from "./status-icon";
import { useTaskActions } from "./use-task-actions";

interface Props {
  summary: TaskSummary;
  depth: number;
  active: boolean;
  checked: boolean;
  selectionMode: boolean;
  now: number;
  onOpen: (event: MouseEvent) => void;
  onCheck: () => void;
}

function subline(summary: TaskSummary, now: number, progress: string | null): string {
  if (summary.runningRunId) return progress ? `läuft · ${progress}` : "läuft …";
  if (!summary.task.enabled)
    return summary.state.disabledReason ? "Automatisch pausiert" : "Pausiert";
  if (summary.state.nextRunAt) return formatRelative(summary.state.nextRunAt, now);
  if (summary.state.lastStatus) return runStatusLabel(summary.state.lastStatus);
  return summary.task.schedules.length ? "Kein nächster Termin" : "Nur manuell";
}

export function TaskListItem({
  summary,
  depth,
  active,
  checked,
  selectionMode,
  now,
  onOpen,
  onCheck,
}: Props) {
  const { task, state } = summary;
  const actions = useTaskActions();
  const progress = useAutomationStore((store) => {
    const run = summary.runningRunId ? store.activeRuns[summary.runningRunId] : undefined;
    return run
      ? `Schritt ${Math.min(run.summary.stepsDone + 1, run.summary.stepsTotal)}/${run.summary.stepsTotal}`
      : null;
  });
  const status = summary.runningRunId ? "running" : state.lastStatus;
  const failing = state.lastStatus === "failed" || state.lastStatus === "timeout";
  const text = subline(summary, now, progress);
  const targets = () => {
    const selection = useAutomationStore.getState().selection;
    return selection.includes(task.id) && selection.length > 1 ? selection : [task.id];
  };

  const menuItems = (Item: typeof ContextMenuItem | typeof DropdownMenuItem) => (
    <>
      <Item onSelect={() => void actions.run(summary)} disabled={Boolean(summary.runningRunId)}>
        <PlayIcon />
        Ausführen
      </Item>
      <Item onSelect={() => void actions.duplicate(summary)}>
        <CopyIcon />
        Duplizieren
      </Item>
      <Item onSelect={() => void actions.copyCommand(summary)}>
        <SquareTerminalIcon />
        Als Befehl kopieren
      </Item>
      <Item onSelect={() => void actions.exportTasks(targets())}>
        <DownloadIcon />
        Exportieren
      </Item>
    </>
  );

  const row = (
    <div
      data-task-row={task.id}
      data-active={active || undefined}
      data-checked={checked || undefined}
      className={cn(
        "group/row relative flex min-h-11 items-center gap-2 rounded-lg pr-1.5 transition-colors",
        "hover:bg-muted/70 data-[active]:bg-accent data-[checked]:bg-primary/8",
        !task.enabled && "text-muted-foreground",
      )}
      style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
    >
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        <span
          className={cn(
            "transition-opacity duration-150",
            selectionMode || checked
              ? "opacity-0"
              : "group-hover/row:opacity-0 group-has-[[role=checkbox]:focus-visible]/row:opacity-0",
          )}
        >
          <StatusIcon status={status} />
        </span>
        <Checkbox
          checked={checked}
          onCheckedChange={onCheck}
          aria-label={`„${task.name}“ auswählen`}
          className={cn(
            "absolute inset-0 m-auto transition-opacity duration-150",
            selectionMode || checked
              ? "opacity-100"
              : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100",
          )}
        />
      </span>
      <button
        type="button"
        data-task-open={task.id}
        onClick={onOpen}
        aria-current={active ? "true" : undefined}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <span className="flex w-full min-w-0 items-center gap-1.5">
          <span
            title={task.name}
            className={cn("truncate text-[13px] font-medium", !task.enabled && "opacity-70")}
          >
            {task.name || "Unbenannter Task"}
          </span>
          {task.needsReview && (
            <span className="shrink-0 rounded-md bg-amber-500/12 px-1.5 py-px text-[10px] font-semibold text-amber-700 dark:text-amber-400">
              Prüfen
            </span>
          )}
        </span>
        <span
          className={cn(
            "truncate text-[11px] tabular-nums",
            summary.runningRunId
              ? "text-primary"
              : failing && task.enabled
                ? "text-destructive"
                : "text-muted-foreground",
          )}
        >
          {failing && task.enabled && !summary.runningRunId
            ? `${runStatusLabel(state.lastStatus ?? "failed")} · ${text}`
            : text}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Aktionen für „${task.name}“`}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity duration-150 hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100 aria-expanded:opacity-100"
        >
          <EllipsisIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {menuItems(DropdownMenuItem)}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => actions.remove(targets())}>
            <Trash2Icon />
            Löschen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Switch
        size="sm"
        checked={task.enabled}
        onCheckedChange={(enabled) => void actions.setEnabled([task.id], enabled)}
        aria-label={task.enabled ? `„${task.name}“ pausieren` : `„${task.name}“ aktivieren`}
      />
      <AiFlash id={`task:${task.id}`} reveal />
    </div>
  );

  const reason = !task.enabled ? state.disabledReason : null;

  return (
    <ContextMenu>
      {reason ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={6}>
            {reason}
          </TooltipContent>
        </Tooltip>
      ) : (
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      )}
      <ContextMenuContent className="w-52">
        {menuItems(ContextMenuItem)}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => actions.remove(targets())}>
          <Trash2Icon />
          Löschen
          <ContextMenuShortcut>Entf</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
