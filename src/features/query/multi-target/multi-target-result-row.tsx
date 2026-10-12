import {
  BanIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleDashedIcon,
  LoaderIcon,
  ShieldXIcon,
  XCircleIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QueryResultTable } from "@/features/query/query-result-table";
import type { DatabaseKind } from "@/lib/db";
import type { TargetRun, TargetStatus } from "@/lib/multi-target";
import { cn } from "@/lib/utils";

const STATUS: Record<TargetStatus, { label: string; icon: typeof LoaderIcon; tone: string }> = {
  queued: { label: "Wartet", icon: CircleDashedIcon, tone: "text-muted-foreground" },
  running: { label: "Läuft", icon: LoaderIcon, tone: "text-primary" },
  done: { label: "Fertig", icon: CheckCircle2Icon, tone: "text-emerald-600 dark:text-emerald-400" },
  error: { label: "Fehler", icon: XCircleIcon, tone: "text-destructive" },
  cancelled: { label: "Abgebrochen", icon: BanIcon, tone: "text-muted-foreground" },
  rejected: { label: "Abgelehnt", icon: ShieldXIcon, tone: "text-destructive" },
};

const NUMBER = new Intl.NumberFormat("de-DE");

interface MultiTargetResultRowProps {
  label: string;
  run: TargetRun | undefined;
  production: boolean;
  expanded: boolean;
  kind?: DatabaseKind;
  onToggle: () => void;
  onCancel: () => void;
}

export function MultiTargetResultRow({
  label,
  run,
  production,
  expanded,
  kind,
  onToggle,
  onCancel,
}: MultiTargetResultRowProps) {
  const status = run?.status ?? "queued";
  const info = STATUS[status];
  const Icon = info.icon;
  const hasGrid = Boolean(run?.result && run.result.columns.length > 0);
  return (
    <div className="border-b" data-multi-target-row={status}>
      <div className="flex min-h-11 items-center gap-2 px-3 py-1.5 text-xs">
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={expanded ? "Ergebnis einklappen" : "Ergebnis ausklappen"}
          aria-expanded={expanded}
          disabled={!hasGrid && !run?.error}
          onClick={onToggle}
        >
          <ChevronRightIcon
            className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
          />
        </Button>
        <Icon
          className={cn("size-3.5 shrink-0", info.tone, status === "running" && "animate-spin")}
          aria-label={info.label}
        />
        <span className="min-w-0 flex-1 truncate font-medium" title={label}>
          {label}
        </span>
        {production && (
          <Badge variant="destructive" className="text-[10px]">
            Produktion
          </Badge>
        )}
        <span className={cn("w-20 shrink-0 text-right", info.tone)}>{info.label}</span>
        <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
          {run?.durationMs != null ? `${NUMBER.format(run.durationMs)} ms` : ""}
        </span>
        <span className="w-28 shrink-0 text-right tabular-nums text-muted-foreground">
          {run?.rowCount != null
            ? `${NUMBER.format(run.rowCount)}${run.truncated ? "+" : ""} Zeilen`
            : run?.rowsAffected != null
              ? `${NUMBER.format(run.rowsAffected)} betroffen`
              : ""}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px]"
          disabled={status !== "queued" && status !== "running"}
          onClick={onCancel}
        >
          Abbrechen
        </Button>
      </div>
      {run?.notice && (
        <p className="px-11 pb-2 text-xs text-amber-700 dark:text-amber-400" title={run.notice}>
          {run.notice}
        </p>
      )}
      {run?.error && !expanded && (
        <p className="truncate px-11 pb-2 text-xs text-destructive" title={run.error}>
          {run.error}
        </p>
      )}
      {expanded && run?.error && (
        <pre className="mx-3 mb-2 whitespace-pre-wrap break-all rounded-md border border-destructive/30 p-2 text-xs text-destructive">
          {run.error}
        </pre>
      )}
      {expanded && hasGrid && run?.result && (
        <div className="mx-3 mb-3 h-80 overflow-hidden rounded-md border" data-multi-target-grid>
          <QueryResultTable result={run.result} isLoading={false} error={null} kind={kind} />
        </div>
      )}
    </div>
  );
}
