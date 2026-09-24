import { AlertTriangleIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  formatCount,
  formatMetric,
  formatMs,
  METRIC_LABEL,
  num,
  type PlanAnalysis,
  type PlanOp,
} from "@/lib/explain-analysis";

const CONDITIONS: [string, string][] = [
  ["Index Cond", "Zugriff"],
  ["Hash Cond", "Hash"],
  ["Merge Cond", "Merge"],
  ["Join Filter", "Join-Filter"],
  ["Filter", "Filter"],
];

const SHOWN = new Set([
  "Plans",
  "Node Type",
  "Relation Name",
  "Index Name",
  "Plan Text",
  ...CONDITIONS.map(([key]) => key),
]);

interface PlanNodeDetailsProps {
  analysis: PlanAnalysis;
  op: PlanOp;
  onClose: () => void;
}

function display(value: unknown): string {
  if (Array.isArray(value)) return value.map(display).join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function PlanNodeDetails({ analysis, op, onClose }: PlanNodeDetailsProps) {
  const node = op.node;
  const share = (value: number) =>
    analysis.total > 0 ? ` (${Math.round((value / analysis.total) * 100)} %)` : "";
  const facts: [string, string][] = [
    [
      `${METRIC_LABEL[analysis.metric]} gesamt`,
      `${formatMetric(op.total, analysis.metric)}${share(op.total)}`,
    ],
    [
      `${METRIC_LABEL[analysis.metric]} selbst`,
      `${formatMetric(op.self, analysis.metric)}${share(op.self)}`,
    ],
  ];
  const cost = num(node["Total Cost"]);
  if (cost !== null && analysis.metric !== "cost")
    facts.push(["Kosten", formatMetric(cost, "cost")]);
  const time = num(node["Actual Total Time"]);
  if (time !== null && analysis.metric !== "time")
    facts.push(["Zeit je Durchlauf", formatMs(time)]);
  if (op.estimatedRows !== null) facts.push(["Zeilen geschätzt", formatCount(op.estimatedRows)]);
  if (op.actualRows !== null) facts.push(["Zeilen tatsächlich", formatCount(op.actualRows)]);
  if (op.loops !== null) facts.push(["Durchläufe", formatCount(op.loops)]);
  const extras = Object.entries(node).filter(
    ([key, value]) => !SHOWN.has(key) && value !== null && value !== undefined && value !== "",
  );
  const planText = typeof node["Plan Text"] === "string" ? node["Plan Text"] : null;

  return (
    <div className="rounded-md border bg-card text-xs" data-plan-details={op.id}>
      <div className="flex items-center gap-2 border-b px-2 py-1.5">
        <span className="font-semibold">{op.label}</span>
        {op.target && <span className="truncate font-mono text-muted-foreground">{op.target}</span>}
        <Button
          size="icon"
          variant="ghost"
          className="ml-auto size-6"
          onClick={onClose}
          title="Details schließen"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
      <div className="space-y-2 px-2 py-2">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        {op.warnings.length > 0 && (
          <ul className="space-y-0.5 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-400">
            {op.warnings.map((warning) => (
              <li key={warning.kind} className="flex items-start gap-1.5">
                <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" />
                {warning.message}
              </li>
            ))}
          </ul>
        )}
        {CONDITIONS.filter(([key]) => node[key]).map(([key, label]) => (
          <p key={key} className="font-mono text-[11px] break-words">
            <span className="text-muted-foreground">{label}: </span>
            {display(node[key])}
          </p>
        ))}
        {planText && (
          <pre className="max-h-48 overflow-auto rounded bg-muted p-2 font-mono text-[11px]">
            {planText}
          </pre>
        )}
        {extras.length > 0 && (
          <details>
            <summary className="cursor-pointer text-muted-foreground">
              Weitere Eigenschaften ({extras.length})
            </summary>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
              {extras.map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">{key}</dt>
                  <dd className="break-words">{display(value)}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </div>
    </div>
  );
}
