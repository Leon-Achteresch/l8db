import type { ExplainNode } from "@/lib/db";
import type { SavedExplainPlan } from "@/lib/explain-file";

export type MetricUnit = "cost" | "ms" | "rows" | "count";

export interface PlanMetrics {
  startupCost: number | null;
  totalCost: number | null;
  planRows: number | null;
  actualTotalTime: number | null;
  actualRows: number | null;
  nodeCount: number;
}

export interface MetricRow {
  key: keyof PlanMetrics;
  label: string;
  unit: MetricUnit;
  left: number | null;
  right: number | null;
  delta: number | null;
  ratio: number | null;
  measured: boolean;
}

export type NodeDiffStatus = "equal" | "changed" | "only-left" | "only-right";

export interface NodeDiffRow {
  signature: string;
  nodeType: string;
  target: string | null;
  leftCount: number;
  rightCount: number;
  status: NodeDiffStatus;
}

export interface ExplainComparison {
  metrics: MetricRow[];
  nodes: NodeDiffRow[];
  warnings: string[];
  comparable: boolean;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function planMetrics(root: ExplainNode): PlanMetrics {
  let nodeCount = 0;
  const walk = (node: ExplainNode) => {
    nodeCount += 1;
    for (const child of node.Plans ?? []) walk(child);
  };
  walk(root);
  return {
    startupCost: numberOrNull(root["Startup Cost"]),
    totalCost: numberOrNull(root["Total Cost"]),
    planRows: numberOrNull(root["Plan Rows"]),
    actualTotalTime: numberOrNull(root["Actual Total Time"]),
    actualRows: numberOrNull(root["Actual Rows"]),
    nodeCount,
  };
}

export function nodeSignature(node: ExplainNode): string {
  const target =
    node["Relation Name"] ?? node["Index Name"] ?? node["Alias"] ?? node["CTE Name"] ?? null;
  return typeof target === "string" && target.length > 0
    ? `${node["Node Type"]} · ${target}`
    : node["Node Type"];
}

function nodeTarget(node: ExplainNode): string | null {
  const target =
    node["Relation Name"] ?? node["Index Name"] ?? node["Alias"] ?? node["CTE Name"] ?? null;
  return typeof target === "string" && target.length > 0 ? target : null;
}

function countNodes(root: ExplainNode): Map<string, { count: number; node: ExplainNode }> {
  const map = new Map<string, { count: number; node: ExplainNode }>();
  const walk = (node: ExplainNode) => {
    const key = nodeSignature(node);
    const entry = map.get(key);
    if (entry) entry.count += 1;
    else map.set(key, { count: 1, node });
    for (const child of node.Plans ?? []) walk(child);
  };
  walk(root);
  return map;
}

export function diffPlanNodes(left: ExplainNode, right: ExplainNode): NodeDiffRow[] {
  const leftMap = countNodes(left);
  const rightMap = countNodes(right);
  const keys = new Set([...leftMap.keys(), ...rightMap.keys()]);
  const rows: NodeDiffRow[] = [];
  for (const key of keys) {
    const leftEntry = leftMap.get(key);
    const rightEntry = rightMap.get(key);
    const leftCount = leftEntry?.count ?? 0;
    const rightCount = rightEntry?.count ?? 0;
    const sample = (leftEntry ?? rightEntry)!.node;
    let status: NodeDiffStatus;
    if (leftCount === 0) status = "only-right";
    else if (rightCount === 0) status = "only-left";
    else if (leftCount !== rightCount) status = "changed";
    else status = "equal";
    rows.push({
      signature: key,
      nodeType: sample["Node Type"],
      target: nodeTarget(sample),
      leftCount,
      rightCount,
      status,
    });
  }
  const order: Record<NodeDiffStatus, number> = {
    "only-left": 0,
    "only-right": 1,
    changed: 2,
    equal: 3,
  };
  return rows.sort(
    (a, b) => order[a.status] - order[b.status] || a.signature.localeCompare(b.signature),
  );
}

const METRIC_DEFS: { key: keyof PlanMetrics; label: string; unit: MetricUnit }[] = [
  { key: "totalCost", label: "Gesamtkosten", unit: "cost" },
  { key: "startupCost", label: "Startkosten", unit: "cost" },
  { key: "actualTotalTime", label: "Gemessene Laufzeit", unit: "ms" },
  { key: "planRows", label: "Geschätzte Zeilen", unit: "rows" },
  { key: "actualRows", label: "Gemessene Zeilen", unit: "rows" },
  { key: "nodeCount", label: "Planknoten", unit: "count" },
];

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

export function compareExplainPlans(
  left: SavedExplainPlan,
  right: SavedExplainPlan,
): ExplainComparison {
  const leftMetrics = planMetrics(left.plan);
  const rightMetrics = planMetrics(right.plan);
  const metrics: MetricRow[] = METRIC_DEFS.map((def) => {
    const a = leftMetrics[def.key];
    const b = rightMetrics[def.key];
    const measured = a !== null && b !== null;
    return {
      key: def.key,
      label: def.label,
      unit: def.unit,
      left: a,
      right: b,
      delta: measured ? (b as number) - (a as number) : null,
      ratio: measured && (a as number) !== 0 ? (b as number) / (a as number) : null,
      measured,
    };
  });

  const warnings: string[] = [];
  if (normalizeSql(left.sql) !== normalizeSql(right.sql)) {
    warnings.push(
      "Die SQL-Anweisungen unterscheiden sich. Kennzahlen sind nur eingeschränkt vergleichbar.",
    );
  }
  if ((left.database ?? "") !== (right.database ?? "")) {
    warnings.push(
      `Unterschiedlicher Datenbankkontext (${left.database ?? "unbekannt"} vs. ${right.database ?? "unbekannt"}). Kennzahlen sind nur eingeschränkt vergleichbar.`,
    );
  }
  if (left.databaseKind !== right.databaseKind) {
    warnings.push(
      `Unterschiedlicher Datenbanktyp (${left.databaseKind || "unbekannt"} vs. ${right.databaseKind || "unbekannt"}).`,
    );
  }
  if (left.mode !== right.mode) {
    warnings.push(
      `Unterschiedliche Erfassungsmodi (${left.mode} vs. ${right.mode}). Laufzeitwerte liegen nur für ANALYZE vor.`,
    );
  }
  if (metrics.some((row) => !row.measured)) {
    warnings.push(
      "Für mindestens eine Kennzahl fehlt auf einer Seite ein Messwert. Fehlende Werte werden nicht als 0 gewertet.",
    );
  }

  return {
    metrics,
    nodes: diffPlanNodes(left.plan, right.plan),
    warnings,
    comparable: warnings.length === 0,
  };
}

export function planToText(root: ExplainNode): string {
  const lines: string[] = [];
  const walk = (node: ExplainNode, depth: number) => {
    const parts = [`${"  ".repeat(depth)}-> ${nodeSignature(node)}`];
    const startup = numberOrNull(node["Startup Cost"]);
    const total = numberOrNull(node["Total Cost"]);
    if (startup !== null && total !== null) {
      parts.push(`(cost=${startup.toFixed(2)}..${total.toFixed(2)}`);
      const rows = numberOrNull(node["Plan Rows"]);
      parts.push(`rows=${rows ?? "?"})`);
    }
    const actual = numberOrNull(node["Actual Total Time"]);
    if (actual !== null) {
      parts.push(
        `(actual time=${actual.toFixed(3)} rows=${numberOrNull(node["Actual Rows"]) ?? "?"})`,
      );
    }
    lines.push(parts.join(" "));
    const cond = node["Index Cond"] ?? node["Hash Cond"] ?? node.Filter;
    if (typeof cond === "string" && cond.length > 0) {
      lines.push(`${"  ".repeat(depth + 1)}Bedingung: ${cond}`);
    }
    for (const child of node.Plans ?? []) walk(child, depth + 1);
  };
  walk(root, 0);
  return lines.join("\n");
}
