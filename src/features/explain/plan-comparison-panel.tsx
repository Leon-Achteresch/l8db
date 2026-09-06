import { AlertTriangleIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DefinitionDiffEditor } from "@/features/compare/definition-diff-editor";
import {
  compareExplainPlans,
  type MetricRow,
  type NodeDiffStatus,
  planToText,
} from "@/lib/explain-compare";
import type { SavedExplainPlan } from "@/lib/explain-file";

interface PlanComparisonPanelProps {
  left: SavedExplainPlan;
  right: SavedExplainPlan;
  leftLabel: string;
  rightLabel: string;
}

const STATUS_LABEL: Record<NodeDiffStatus, string> = {
  "only-left": "nur A",
  "only-right": "nur B",
  changed: "Anzahl geändert",
  equal: "gleich",
};

function formatMetric(value: number | null, unit: MetricRow["unit"]): string {
  if (value === null) return "nicht gemessen";
  if (unit === "ms") return `${value.toFixed(2)} ms`;
  if (unit === "cost") return value.toFixed(2);
  return String(value);
}

function formatDelta(row: MetricRow): string {
  if (!row.measured || row.delta === null) return "—";
  const sign = row.delta > 0 ? "+" : "";
  const base = `${sign}${formatMetric(row.delta, row.unit)}`;
  if (row.ratio === null) return base;
  return `${base} (${(row.ratio * 100).toFixed(0)} %)`;
}

export function PlanComparisonPanel({
  left,
  right,
  leftLabel,
  rightLabel,
}: PlanComparisonPanelProps) {
  const [showTextDiff, setShowTextDiff] = useState(false);
  const comparison = useMemo(() => compareExplainPlans(left, right), [left, right]);
  const texts = useMemo(
    () => ({ left: planToText(left.plan), right: planToText(right.plan) }),
    [left, right],
  );

  return (
    <div className="flex flex-col gap-3">
      {comparison.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangleIcon className="size-3.5" />
            Eingeschränkte Vergleichbarkeit
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-700 dark:text-amber-400">
            {comparison.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Kennzahl</th>
              <th className="px-3 py-2 text-right font-medium">{leftLabel}</th>
              <th className="px-3 py-2 text-right font-medium">{rightLabel}</th>
              <th className="px-3 py-2 text-right font-medium">Delta</th>
            </tr>
          </thead>
          <tbody>
            {comparison.metrics.map((row) => (
              <tr key={row.key} className="border-t">
                <td className="px-3 py-1.5">{row.label}</td>
                <td
                  className={`px-3 py-1.5 text-right tabular-nums ${row.left === null ? "text-muted-foreground italic" : ""}`}
                >
                  {formatMetric(row.left, row.unit)}
                </td>
                <td
                  className={`px-3 py-1.5 text-right tabular-nums ${row.right === null ? "text-muted-foreground italic" : ""}`}
                >
                  {formatMetric(row.right, row.unit)}
                </td>
                <td
                  className={`px-3 py-1.5 text-right tabular-nums ${
                    !row.measured
                      ? "text-muted-foreground"
                      : row.delta === 0
                        ? ""
                        : (row.delta ?? 0) < 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-destructive"
                  }`}
                >
                  {formatDelta(row)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border">
        <p className="border-b px-3 py-2 text-xs font-semibold">Knotenunterschiede</p>
        <ul className="max-h-64 divide-y overflow-y-auto">
          {comparison.nodes.map((node) => (
            <li key={node.signature} className="flex items-center gap-2 px-3 py-1.5 text-xs">
              <Badge
                variant={
                  node.status === "equal"
                    ? "secondary"
                    : node.status === "changed"
                      ? "outline"
                      : "default"
                }
              >
                {STATUS_LABEL[node.status]}
              </Badge>
              <span className="font-medium">{node.nodeType}</span>
              {node.target && <span className="font-mono text-muted-foreground">{node.target}</span>}
              <span className="ml-auto tabular-nums text-muted-foreground">
                {node.leftCount} × / {node.rightCount} ×
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <p className="text-xs font-semibold">Text-Diff der Planbäume</p>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 px-2 text-xs"
            onClick={() => setShowTextDiff((open) => !open)}
          >
            {showTextDiff ? "Ausblenden" : "Anzeigen"}
          </Button>
        </div>
        {showTextDiff && (
          <div className="h-80">
            <DefinitionDiffEditor
              original={texts.left}
              modified={texts.right}
              onlyDifferences={false}
            />
          </div>
        )}
      </div>
    </div>
  );
}
