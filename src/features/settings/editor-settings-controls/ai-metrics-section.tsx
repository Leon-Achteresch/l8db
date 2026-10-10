import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EDITOR_AI_ACTION_LABELS,
  type EditorAiAction,
  summarizeEditorAiStats,
  useEditorAiMetrics,
} from "@/lib/ai/editor/metrics";
import { Row } from "./row";

const percent = (value: number | null) => (value === null ? "–" : `${Math.round(value * 100)} %`);
const number = (value: number) => value.toLocaleString("de-DE");

export function EditorAiMetricsSection() {
  const actions = useEditorAiMetrics((state) => state.actions);
  const since = useEditorAiMetrics((state) => state.since);
  const reset = useEditorAiMetrics((state) => state.reset);
  const rows = (
    Object.entries(actions) as [EditorAiAction, NonNullable<(typeof actions)[EditorAiAction]>][]
  )
    .filter(([, stats]) => stats.requests || stats.errors || stats.cacheHits)
    .sort((a, b) => b[1].requests - a[1].requests);
  const cost = rows.reduce((total, [, stats]) => total + stats.cost, 0);

  return (
    <Row
      settingId="editor-ai-metrics"
      featureId="settings.editor.ai-metrics"
      compact={false}
      stacked
    >
      <div className="flex w-full min-w-0 flex-col items-end gap-2">
        {rows.length ? (
          <div className="w-full overflow-x-auto rounded-lg border border-border/70">
            <table className="w-full min-w-[34rem] text-left text-[11px] tabular-nums">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 font-medium">Aktion</th>
                  <th className="px-2 py-1 text-right font-medium">Anfragen</th>
                  <th className="px-2 py-1 text-right font-medium">Tokens/Anfrage</th>
                  <th className="px-2 py-1 text-right font-medium">Cache</th>
                  <th className="px-2 py-1 text-right font-medium">Angenommen</th>
                  <th className="px-2 py-1 text-right font-medium">Median / p95</th>
                  <th className="px-2 py-1 text-right font-medium">Korrekturen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([action, stats]) => {
                  const summary = summarizeEditorAiStats(stats);
                  return (
                    <tr key={action} className="border-t border-border/60">
                      <td className="px-2 py-1">{EDITOR_AI_ACTION_LABELS[action]}</td>
                      <td className="px-2 py-1 text-right">
                        {number(stats.requests)}
                        {stats.cacheHits ? (
                          <span className="text-muted-foreground">
                            {" "}
                            +{number(stats.cacheHits)} lokal
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1 text-right">{number(summary.tokensPerRequest)}</td>
                      <td className="px-2 py-1 text-right">{percent(summary.cacheRate)}</td>
                      <td className="px-2 py-1 text-right">{percent(summary.acceptRate)}</td>
                      <td className="px-2 py-1 text-right">
                        {number(summary.medianMs)} / {number(summary.p95Ms)} ms
                      </td>
                      <td className="px-2 py-1 text-right">{number(stats.retries)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Noch keine KI-Anfragen aus dem Editor.</p>
        )}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>
            Seit {new Date(since).toLocaleDateString("de-DE")}
            {cost > 0
              ? ` · ca. ${cost.toLocaleString("de-DE", { style: "currency", currency: "USD" })}`
              : ""}
          </span>
          <Button type="button" size="xs" variant="ghost" onClick={reset} disabled={!rows.length}>
            <RotateCcw />
            Zurücksetzen
          </Button>
        </div>
      </div>
    </Row>
  );
}
