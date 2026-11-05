import { Loader, Play, ShieldCheck, TextSelect } from "lucide";
import { ChevronDownIcon, SquareIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { QueryNotificationToggle } from "@/features/query/query-notification-toggle";
import { cn } from "@/lib/utils";
import type { QueryExecutionState } from "./use-query-execution-state";
import type { RunActions } from "./use-run-actions";

interface RunControlsProps {
  actions: RunActions;
  exec: QueryExecutionState;
  runLabel: string;
  hasSelection: boolean;
  connected: boolean;
  hasSql: boolean;
  showScript: boolean;
  onOpenScript: () => void;
  shortcutLabel: (id: string) => string;
  children?: ReactNode;
}

export function RunControls({
  actions,
  exec,
  runLabel,
  hasSelection,
  connected,
  hasSql,
  showScript,
  onOpenScript,
  shortcutLabel,
  children,
}: RunControlsProps) {
  const { isRunning, isChecking, activeJob, stopActiveJob } = exec;
  const runDisabled = isRunning || !connected || !hasSql;
  const runBlockedReason = isRunning
    ? "Eine Abfrage läuft bereits"
    : !connected
      ? "Keine Verbindung aktiv"
      : !hasSql
        ? "Kein SQL im Editor"
        : undefined;
  return (
    <>
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex shrink-0 items-stretch">
          <Button
            size="sm"
            variant="default"
            className="h-8 gap-1.5 rounded-r-none border-r border-primary-foreground/25 px-2.5 text-xs disabled:bg-primary/45 disabled:opacity-100 @min-[42rem]/qtb:px-3"
            data-tour="query-run"
            data-hotkey={hasSelection ? "query.runSelection" : "query.run"}
            onClick={actions.handleRun}
            disabled={runDisabled}
            disabledReason={runBlockedReason}
            title={`${runLabel} (${shortcutLabel("query.run")})`}
          >
            <MorphIcon icon={hasSelection ? TextSelect : Play} className="size-3.5" />
            <span className="sr-only @min-[42rem]/qtb:not-sr-only">{runLabel}</span>
          </Button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="default"
                className="h-8 w-8 rounded-l-none px-0 disabled:bg-primary/45 disabled:opacity-100"
                aria-label="Weitere Ausführungsarten"
                title="Weitere Ausführungsarten"
                disabled={runDisabled}
                disabledReason={runBlockedReason}
              >
                <ChevronDownIcon className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-52 whitespace-nowrap">
              <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                Ausführung
              </DropdownMenuLabel>
              <DropdownMenuItem
                data-tour="query-run-statement"
                data-hotkey="query.runStatement"
                onClick={actions.handleRunStatement}
                disabled={runDisabled}
              >
                Statement unter Cursor
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {shortcutLabel("query.runStatement")}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                data-hotkey="query.runSelection"
                onClick={actions.handleRunSelection}
                disabled={isRunning || !connected || !hasSelection}
              >
                Auswahl ausführen
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {shortcutLabel("query.runSelection")}
                </span>
              </DropdownMenuItem>
              {showScript && (
                <DropdownMenuItem
                  onClick={onOpenScript}
                  disabled={isRunning || !connected || !hasSql}
                >
                  Skript mit Einzelergebnissen
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {isRunning && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 px-2 text-xs"
            disabled={!activeJob?.cancellable || activeJob.status === "cancelling"}
            disabledReason={
              activeJob?.status === "cancelling"
                ? "Abbruch wurde bereits angefordert"
                : "Dieser Treiber unterstützt keinen direkten Abfrageabbruch"
            }
            data-hotkey="query.cancel"
            onClick={stopActiveJob}
            title={
              activeJob?.cancellable
                ? `Abbrechen (${shortcutLabel("query.cancel")})`
                : "Dieser Treiber unterstützt keinen direkten Abfrageabbruch. Das konfigurierte Timeout bleibt wirksam."
            }
          >
            <SquareIcon className="size-3.5" />
            <span className="sr-only @min-[54rem]/qtb:not-sr-only">
              {activeJob?.status === "cancelling" ? "Abbruch angefordert…" : "Abbrechen"}
            </span>
          </Button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 px-2 text-xs"
          data-tour="query-check"
          data-hotkey="query.check"
          onClick={() => void actions.handleCheck()}
          disabled={isRunning || isChecking || !connected || !hasSql}
          disabledReason={isChecking ? "Prüfung läuft bereits" : runBlockedReason}
          title={`Nur prüfen — Änderungen werden zurückgerollt, nichts wird übernommen (${shortcutLabel("query.check")})`}
        >
          <MorphIcon
            icon={isChecking ? Loader : ShieldCheck}
            className={cn("size-3.5", isChecking && "animate-spin")}
          />
          <span className="sr-only @min-[54rem]/qtb:not-sr-only">
            {isChecking ? "Prüfe…" : "Prüfen"}
          </span>
        </Button>
        <QueryNotificationToggle />
        {children}
      </div>
    </>
  );
}
