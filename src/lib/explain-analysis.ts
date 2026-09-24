import type { ExplainNode } from "@/lib/db";

export type PlanMetricKind = "time" | "cost" | "nodes";

export type PlanWarningKind = "full-scan" | "index-hint" | "misestimate" | "spill" | "nested-loop";

export interface PlanWarning {
  kind: PlanWarningKind;
  message: string;
}

export interface PlanOp {
  id: string;
  parentId: string | null;
  depth: number;
  node: ExplainNode;
  children: string[];
  label: string;
  target: string | null;
  total: number;
  self: number;
  estimatedRows: number | null;
  actualRows: number | null;
  loops: number | null;
  rows: number | null;
  warnings: PlanWarning[];
}

export interface PlanAnalysis {
  metric: PlanMetricKind;
  root: PlanOp;
  ops: PlanOp[];
  byId: Map<string, PlanOp>;
  total: number;
  maxRows: number;
  analyzed: boolean;
}

export const LARGE_TABLE_ROWS = 10_000;
export const MISESTIMATE_FACTOR = 10;
export const HIGH_LOOPS = 1_000;

const FULL_SCAN =
  /(seq scan|table scan|table access full|full scan|clustered index scan|full table scan)/i;
const NESTED_LOOP = /nested loop/i;
const SPILL_OPERATOR = /(sort|hash|aggregate|materialize|window)/i;

export const ROOT_ID = "0";

export function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function planTarget(node: ExplainNode): string | null {
  return (
    str(node["Relation Name"]) ??
    str(node["Index Name"]) ??
    str(node["CTE Name"]) ??
    str(node.Alias) ??
    null
  );
}

function childrenOf(node: ExplainNode): ExplainNode[] {
  return Array.isArray(node.Plans) ? node.Plans : [];
}

function timeOf(node: ExplainNode): number | null {
  const time = num(node["Actual Total Time"]);
  if (time === null) return null;
  const loops = num(node["Actual Loops"]);
  return time * (loops ?? 1);
}

function actualRowsOf(node: ExplainNode): number | null {
  const rows = num(node["Actual Rows"]);
  if (rows === null) return null;
  return rows * (num(node["Actual Loops"]) ?? 1);
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: value < 10 ? 1 : 0,
    notation: value >= 1_000_000 ? "compact" : "standard",
  }).format(value);
}

export function formatMs(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return value < 10 ? `${value.toFixed(2)} ms` : `${Math.round(value)} ms`;
}

export function formatMetric(value: number, metric: PlanMetricKind): string {
  if (metric === "time") return formatMs(value);
  if (metric === "cost") return value < 100 ? value.toFixed(2) : formatCount(value);
  return formatCount(value);
}

export const METRIC_LABEL: Record<PlanMetricKind, string> = {
  time: "Zeit",
  cost: "Kosten",
  nodes: "Knoten",
};

function estimateFactor(estimated: number, actual: number): number {
  return Math.max((actual + 1) / (estimated + 1), (estimated + 1) / (actual + 1));
}

function isSpill(node: ExplainNode): boolean {
  const type = String(node["Node Type"] ?? "");
  if (String(node["Sort Space Type"] ?? "").toLowerCase() === "disk") return true;
  if (/external/i.test(String(node["Sort Method"] ?? ""))) return true;
  if ((num(node["Hash Batches"]) ?? 0) > 1) return true;
  if (node.Spilled === true) return true;
  if (/spill/i.test(String(node.Warnings ?? ""))) return true;
  return SPILL_OPERATOR.test(type) && (num(node["Temp Written Blocks"]) ?? 0) > 0;
}

export function planWarnings(node: ExplainNode): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  const type = String(node["Node Type"] ?? "");
  const target = planTarget(node);
  const estimated = num(node["Plan Rows"]);
  const perLoop = num(node["Actual Rows"]);
  const loops = num(node["Actual Loops"]);
  const actual = actualRowsOf(node);
  const removed = (num(node["Rows Removed by Filter"]) ?? 0) * (loops ?? 1);

  if (FULL_SCAN.test(type)) {
    const scanned = Math.max(
      estimated ?? 0,
      (actual ?? 0) + removed,
      num(node["Rows Examined"]) ?? 0,
    );
    if (scanned >= LARGE_TABLE_ROWS) {
      warnings.push({
        kind: "full-scan",
        message: `Vollständiger Scan${target ? ` von ${target}` : ""} über ~${formatCount(scanned)} Zeilen`,
      });
      const filter = str(node.Filter);
      const discards = actual !== null ? removed >= HIGH_LOOPS && removed >= actual : true;
      if (filter && discards) {
        warnings.push({
          kind: "index-hint",
          message:
            "Filter auf einem vollständigen Scan: ein Index auf den Filterspalten könnte helfen",
        });
      }
    }
  }

  if (estimated !== null && perLoop !== null && (loops ?? 1) > 0) {
    const factor = estimateFactor(estimated, perLoop);
    if (factor >= MISESTIMATE_FACTOR) {
      warnings.push({
        kind: "misestimate",
        message: `Zeilenschätzung um Faktor ${formatCount(Math.round(factor))} daneben (geschätzt ${formatCount(estimated)}, tatsächlich ${formatCount(perLoop)})`,
      });
    }
  }

  if (isSpill(node)) {
    warnings.push({
      kind: "spill",
      message: /sort/i.test(type)
        ? "Sortierung lagert auf die Festplatte aus"
        : "Operator lagert auf die Festplatte aus",
    });
  }

  if (NESTED_LOOP.test(type)) {
    const children = childrenOf(node);
    const measured = children
      .map((child) => num(child["Actual Loops"]))
      .filter((value): value is number => value !== null);
    const iterations =
      measured.length > 0
        ? Math.max(...measured)
        : children[0]
          ? (num(children[0]["Plan Rows"]) ?? 0)
          : 0;
    if (iterations >= HIGH_LOOPS) {
      warnings.push({
        kind: "nested-loop",
        message: `Nested Loop mit ~${formatCount(iterations)} Schleifendurchläufen`,
      });
    }
  }
  return warnings;
}

export function childId(parentId: string, index: number): string {
  return `${parentId}.${index}`;
}

export function analyzePlan(root: ExplainNode): PlanAnalysis {
  const ops: PlanOp[] = [];
  const byId = new Map<string, PlanOp>();
  let timed = 0;
  let costed = 0;
  const collect = (node: ExplainNode, id: string, parentId: string | null, depth: number) => {
    const children = childrenOf(node);
    const actual = actualRowsOf(node);
    const estimated = num(node["Plan Rows"]);
    const op: PlanOp = {
      id,
      parentId,
      depth,
      node,
      children: children.map((_, index) => childId(id, index)),
      label: String(node["Node Type"] ?? "?"),
      target: planTarget(node),
      total: 0,
      self: 0,
      estimatedRows: estimated,
      actualRows: actual,
      loops: num(node["Actual Loops"]),
      rows: actual ?? estimated,
      warnings: planWarnings(node),
    };
    if (timeOf(node) !== null) timed += 1;
    if ((num(node["Total Cost"]) ?? 0) > 0) costed += 1;
    ops.push(op);
    byId.set(id, op);
    for (const [index, child] of children.entries()) {
      collect(child, childId(id, index), id, depth + 1);
    }
  };
  collect(root, ROOT_ID, null, 0);

  const metric: PlanMetricKind =
    timed > 0 && timed * 2 >= ops.length ? "time" : costed > 0 ? "cost" : "nodes";
  const raw = (node: ExplainNode): number | null =>
    metric === "time" ? timeOf(node) : metric === "cost" ? num(node["Total Cost"]) : 1;

  for (let index = ops.length - 1; index >= 0; index -= 1) {
    const op = ops[index];
    const childTotal = op.children.reduce((sum, id) => sum + (byId.get(id)?.total ?? 0), 0);
    const value = Math.max(0, raw(op.node) ?? 0);
    if (metric === "nodes") {
      op.total = 1 + childTotal;
      op.self = 1;
    } else {
      op.total = Math.max(value, childTotal);
      op.self = Math.max(0, op.total - childTotal);
    }
  }

  const first = ops[0];
  return {
    metric,
    root: first,
    ops,
    byId,
    total: first.total,
    maxRows: ops.reduce((max, op) => Math.max(max, op.rows ?? 0), 0),
    analyzed: timed > 0,
  };
}

export function selfShare(analysis: PlanAnalysis, op: PlanOp): number {
  return analysis.total > 0 ? op.self / analysis.total : 0;
}

export function heatColor(share: number): string {
  const t = Math.sqrt(Math.min(1, Math.max(0, share)));
  const hue = Math.round(50 - 50 * t);
  const alpha = (0.1 + 0.5 * t).toFixed(2);
  return `hsl(${hue} 90% 50% / ${alpha})`;
}

export function ancestorsOf(analysis: PlanAnalysis, id: string): PlanOp[] {
  const out: PlanOp[] = [];
  let current = analysis.byId.get(id)?.parentId ?? null;
  while (current) {
    const op = analysis.byId.get(current);
    if (!op) break;
    out.unshift(op);
    current = op.parentId;
  }
  return out;
}
