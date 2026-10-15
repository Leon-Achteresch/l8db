import { Loader, Play, ShieldCheck, TextSelect } from "lucide";
import { ChevronDownIcon, SquareIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
}: RunControlsProps) {
  const { isRunning, isChecking, activeJob, stopActiveJob } = exec;
  const runDisabled = isRunning || !connected || !hasSql;
  return (
    <>
      <div className="flex shrink-0 items-stretch">
        <Button
          size="sm"
          variant="default"
          className="h-7 gap-1.5 rounded-r-none border-r border-primary-foreground/25 px-2.5 text-xs @min-[42rem]/qtb:px-3"
          data-tour="query-run"
          onClick={actions.handleRun}
          disabled={runDisabled}
          title={`${runLabel} (${shortcutLabel("query.run")})`}
        >
          <MorphIcon icon={hasSelection ? TextSelect : Play} className="size-3" />
          <span className="sr-only @min-[42rem]/qtb:not-sr-only">{runLabel}</span>
        </Button>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="default"
              className="h-7 w-8 rounded-l-none px-0"
              aria-label="Weitere Ausführungsarten"
              title="Weitere Ausführungsarten"
              disabled={runDisabled}
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
              onClick={actions.handleRunStatement}
              disabled={runDisabled}
            >
              Statement unter Cursor
              <span className="ml-auto text-[10px] text-muted-foreground">
                {shortcutLabel("query.runStatement")}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
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
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 px-2 text-xs @min-[54rem]/qtb:px-3"
        data-tour="query-check"
        onClick={() => void actions.handleCheck()}
        disabled={isRunning || isChecking || !connected || !hasSql}
        title={`Nur prüfen — Änderungen werden zurückgerollt, nichts wird übernommen (${shortcutLabel("query.check")})`}
      >
        <MorphIcon
          icon={isChecking ? Loader : ShieldCheck}
          className={cn("size-3", isChecking && "animate-spin")}
        />
        <span className="sr-only @min-[54rem]/qtb:not-sr-only">
          {isChecking ? "Prüfe…" : "Prüfen"}
        </span>
      </Button>
      {isRunning && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-xs @min-[54rem]/qtb:px-3"
          disabled={!activeJob?.cancellable || activeJob.status === "cancelling"}
          onClick={stopActiveJob}
          title={
            activeJob?.cancellable
              ? `Abbrechen (${shortcutLabel("query.cancel")})`
              : "Dieser Treiber unterstützt keinen direkten Abfrageabbruch. Das konfigurierte Timeout bleibt wirksam."
          }
        >
          <SquareIcon className="size-3" />
          <span className="sr-only @min-[54rem]/qtb:not-sr-only">
            {activeJob?.status === "cancelling" ? "Abbruch angefordert…" : "Abbrechen"}
          </span>
        </Button>
      )}
    </>
  );
}
