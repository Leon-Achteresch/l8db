import { GaugeIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { PerfModeHint } from "@/features/explain/perf-mode-hint";
import { PerfRunControls, type PerfRunSettings } from "@/features/explain/perf-run-controls";
import { PerfRunsReport } from "@/features/explain/perf-runs-report";
import { useActiveCapabilities } from "@/lib/db-selection";
import { usePerfRunner } from "@/lib/hooks/use-perf-runner";
import {
  isReadOnlyFor,
  normalizeConcurrency,
  normalizeRepeats,
  PERF_DEFAULT_CONCURRENCY,
  PERF_DEFAULT_REPEATS,
  perfStatement,
  readOnlyRequirement,
} from "@/lib/perf-test";

interface QueryPerfPanelProps {
  sql: string;
  onClose: () => void;
}

export function QueryPerfPanel({ sql, onClose }: QueryPerfPanelProps) {
  const runner = usePerfRunner();
  const language = useActiveCapabilities().query_language;
  const [settings, setSettings] = useState<PerfRunSettings>({
    repeats: String(PERF_DEFAULT_REPEATS),
    concurrency: String(PERF_DEFAULT_CONCURRENCY),
    timed: false,
  });

  const statement = useMemo(() => perfStatement(language, sql), [language, sql]);
  const readOnly = useMemo(() => isReadOnlyFor(language, sql), [language, sql]);
  const timed = settings.timed || !runner.canExplain;

  return (
    <div className="flex max-h-[60%] shrink-0 flex-col gap-3 overflow-y-auto border-b bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <GaugeIcon className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold">Performance-Test der aktuellen Abfrage</span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto size-6 p-0"
          onClick={onClose}
          title="Schließen"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>

      <PerfModeHint timed={timed} />

      {!readOnly && statement.length > 0 && (
        <p className="text-xs text-destructive">{readOnlyRequirement(language)}</p>
      )}

      <PerfRunControls
        idPrefix="query-perf"
        runner={runner}
        settings={settings}
        onSettingsChange={setSettings}
        startLabel="Abfrage testen"
        startDisabled={!readOnly}
        onStart={() =>
          void runner.start({
            sql: statement,
            repeats: normalizeRepeats(Number.parseInt(settings.repeats, 10)),
            concurrency: normalizeConcurrency(Number.parseInt(settings.concurrency, 10)),
            analyze: true,
            timed,
            definition: null,
          })
        }
      />

      {runner.current && runner.current.sql !== statement && (
        <p className="text-xs text-muted-foreground">
          Gemessene Abfrage weicht vom aktuellen Editorinhalt ab:{" "}
          <span className="font-mono">{runner.current.sql}</span>
        </p>
      )}

      {runner.error && <p className="text-xs text-destructive">{runner.error}</p>}

      <PerfRunsReport
        current={runner.current}
        running={runner.running}
        fileBase="query"
        onError={runner.setError}
      />
    </div>
  );
}
