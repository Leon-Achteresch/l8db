import { PlayIcon, SquareIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { PerfRunnerState } from "@/lib/hooks/use-perf-runner";
import {
  PERF_MAX_CONCURRENCY,
  PERF_MAX_REPEATS,
  PERF_MIN_CONCURRENCY,
  PERF_MIN_REPEATS,
} from "@/lib/perf-test";

export interface PerfRunSettings {
  repeats: string;
  concurrency: string;
  timed: boolean;
}

interface PerfRunControlsProps {
  idPrefix: string;
  runner: PerfRunnerState;
  settings: PerfRunSettings;
  onSettingsChange: (settings: PerfRunSettings) => void;
  onStart: () => void;
  startLabel: string;
  startDisabled: boolean;
}

export function PerfRunControls({
  idPrefix,
  runner,
  settings,
  onSettingsChange,
  onStart,
  startLabel,
  startDisabled,
}: PerfRunControlsProps) {
  const set = (patch: Partial<PerfRunSettings>) => onSettingsChange({ ...settings, ...patch });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor={`${idPrefix}-repeats`}>
            Läufe gesamt
          </Label>
          <Input
            id={`${idPrefix}-repeats`}
            type="number"
            min={PERF_MIN_REPEATS}
            max={PERF_MAX_REPEATS}
            value={settings.repeats}
            onChange={(event) => set({ repeats: event.target.value })}
            className="h-8 w-28 text-xs"
            disabled={runner.running}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor={`${idPrefix}-concurrency`}>
            Parallele Verbindungen
          </Label>
          <Input
            id={`${idPrefix}-concurrency`}
            type="number"
            min={PERF_MIN_CONCURRENCY}
            max={PERF_MAX_CONCURRENCY}
            value={settings.concurrency}
            onChange={(event) => set({ concurrency: event.target.value })}
            className="h-8 w-28 text-xs"
            disabled={runner.running}
          />
        </div>
        {runner.canExplain ? (
          <div className="flex h-8 items-center gap-2">
            <Switch
              id={`${idPrefix}-timed`}
              checked={settings.timed}
              onCheckedChange={(checked) => set({ timed: checked })}
              disabled={runner.running}
            />
            <Label className="text-xs" htmlFor={`${idPrefix}-timed`}>
              Nur Laufzeit messen (ohne EXPLAIN)
            </Label>
          </div>
        ) : (
          <p className="flex h-8 items-center text-xs text-muted-foreground">
            Ohne EXPLAIN: gemessen wird die Laufzeit der echten Ausführung.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="h-7 gap-1.5 px-2.5 text-xs"
          onClick={onStart}
          disabled={runner.running || !runner.canRun || startDisabled}
        >
          <PlayIcon className="size-3.5" />
          {startLabel}
        </Button>
        {runner.running && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2.5 text-xs"
            onClick={runner.cancel}
          >
            <SquareIcon className="size-3.5" />
            Abbrechen
          </Button>
        )}
        {runner.progress && (
          <span className="text-xs text-muted-foreground">
            {runner.progress.done} von {runner.progress.total} Läufen fertig…
          </span>
        )}
      </div>
    </div>
  );
}
