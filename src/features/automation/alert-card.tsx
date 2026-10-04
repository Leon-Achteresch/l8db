import {
  BellIcon,
  BellOffIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  PlayIcon,
  SirenIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import {
  alertStatusLabel,
  formatClock,
  formatDateTime,
  formatRelative,
} from "@/lib/automation/format";
import { useAutomationStore } from "@/lib/automation/store";
import { toast } from "@/lib/automation/toast";
import {
  type Action,
  type AlertState,
  type AlertStatus,
  type Step,
  setAutomationAlertMute,
  type TaskSummary,
} from "@/lib/db/automation";
import { cn } from "@/lib/utils";
import { AlertMuteUntilDialog } from "./alert-mute-until-dialog";
import { useTaskActions } from "./use-task-actions";

interface Props {
  summary: TaskSummary;
  step: Step;
  state: AlertState | undefined;
  now: number;
}

const STATUS_STYLE: Record<AlertStatus, { icon: typeof SirenIcon; pill: string; card: string }> = {
  triggered: {
    icon: SirenIcon,
    pill: "bg-destructive text-white dark:text-background",
    card: "border-destructive/35 bg-destructive/[0.04] dark:bg-destructive/[0.07]",
  },
  error: {
    icon: TriangleAlertIcon,
    pill: "bg-amber-500/12 text-amber-800 dark:text-amber-300",
    card: "border-amber-500/35",
  },
  unknown: {
    icon: CircleHelpIcon,
    pill: "bg-muted text-muted-foreground",
    card: "border-dashed",
  },
  ok: {
    icon: CircleCheckIcon,
    pill: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    card: "",
  },
};

const OPS: Record<string, string> = {
  eq: "=",
  ne: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  contains: "enthält",
  not_contains: "enthält nicht",
  matches: "passt zu",
  empty: "ist leer",
  not_empty: "ist nicht leer",
};

function conditionText(action: Action): string {
  if (action.type !== "alert") return "";
  const { condition } = action;
  switch (condition.type) {
    case "has_rows":
      return "Löst aus, wenn die Abfrage Zeilen liefert";
    case "no_rows":
      return "Löst aus, wenn die Abfrage keine Zeilen liefert";
    case "error":
      return "Löst aus, wenn die Abfrage fehlschlägt";
    case "value":
      return `Löst aus, wenn ${condition.column ?? "der erste Wert"} ${OPS[condition.op] ?? condition.op} ${condition.threshold}`;
    default:
      return "";
  }
}

export function AlertCard({ summary, step, state, now }: Props) {
  const applyEvent = useAutomationStore((store) => store.applyEvent);
  const { run } = useTaskActions();
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState(false);
  const status = state?.status ?? "unknown";
  const style = STATUS_STYLE[status];
  const mutedUntil = state?.mutedUntil ? new Date(state.mutedUntil).getTime() : 0;
  const muted = mutedUntil > now;
  const running = Boolean(summary.runningRunId);

  const mute = async (until: Date | null) => {
    setBusy(true);
    try {
      const next = await setAutomationAlertMute(
        summary.task.id,
        step.id,
        until?.toISOString() ?? null,
      );
      applyEvent({ event: "alert_changed", alert: next });
      setCustom(false);
      toast.success(until ? `Stumm bis ${formatDateTime(until)}` : "Stummschaltung aufgehoben");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const muteFor = (hours: number) => void mute(new Date(Date.now() + hours * 3_600_000));

  return (
    <article
      data-alert-step={step.id}
      data-alert-status={status}
      aria-labelledby={`alert-${step.id}`}
      className={cn(
        "flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-xs transition-colors",
        style.card,
      )}
    >
      <header className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3
            id={`alert-${step.id}`}
            title={step.name || undefined}
            className="truncate text-sm font-semibold"
          >
            {step.name || "Abfrage-Alarm"}
          </h3>
          <p title={summary.task.name} className="truncate text-xs text-muted-foreground">
            {summary.task.name}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            style.pill,
          )}
        >
          <style.icon aria-hidden className="size-3" />
          {alertStatusLabel(status)}
        </span>
      </header>

      <dl className="grid grid-cols-3 gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-[11px] text-muted-foreground">Letzter Wert</dt>
          <dd
            className="truncate font-mono text-[13px] tabular-nums"
            title={state?.lastValue ?? undefined}
          >
            {state?.lastValue ?? "–"}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-[11px] text-muted-foreground">Seit</dt>
          <dd className="truncate text-[13px] tabular-nums" title={formatDateTime(state?.since)}>
            {state?.since ? formatRelative(state.since, now) : "–"}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-[11px] text-muted-foreground">Geprüft</dt>
          <dd
            className="truncate text-[13px] tabular-nums"
            title={formatDateTime(state?.checkedAt)}
          >
            {state?.checkedAt ? formatRelative(state.checkedAt, now) : "noch nie"}
          </dd>
        </div>
      </dl>

      <p className="text-xs text-pretty text-muted-foreground">{conditionText(step.action)}</p>

      <footer className="mt-auto flex items-center gap-2 border-t pt-3">
        {muted ? (
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
            <BellOffIcon aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">
              Stumm bis{" "}
              {mutedUntil - now < 86_400_000 ? formatClock(mutedUntil) : formatDateTime(mutedUntil)}
            </span>
          </span>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
            <BellIcon aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">Meldet Wechsel</span>
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="xs" variant="ghost" disabled={busy} data-testid="automation-alert-mute">
              {busy ? <Spinner className="size-3" /> : muted ? <BellIcon /> : <BellOffIcon />}
              {muted ? "Stumm" : "Stummschalten"}
              <ChevronDownIcon className="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => muteFor(1)}>1 Stunde</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => muteFor(8)}>8 Stunden</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => muteFor(24)}>24 Stunden</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setCustom(true)}>Bis …</DropdownMenuItem>
            {muted && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void mute(null)}>Aufheben</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="xs" variant="outline" disabled={running} onClick={() => void run(summary)}>
          {running ? <Spinner className="size-3" /> : <PlayIcon />}
          Jetzt prüfen
        </Button>
      </footer>
      <AlertMuteUntilDialog
        open={custom}
        name={step.name}
        onOpenChange={setCustom}
        onConfirm={(until) => void mute(until)}
      />
    </article>
  );
}
