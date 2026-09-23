import type { ExplainNode } from "@/lib/db";

type SizeBucket = "none" | "1" | "2-9" | "10-99" | "100-999" | "1k-9k" | "10k+";
type TimeBucket = "unknown" | "<1ms" | "1-9ms" | "10-99ms" | "100-999ms" | "1s+";
type NodeKind =
  | "sequential_scan"
  | "index_scan"
  | "bitmap_scan"
  | "sort"
  | "hash"
  | "nested_loop"
  | "merge_join"
  | "hash_join"
  | "aggregate"
  | "limit"
  | "other";

export interface PlanSummaryNode {
  kind: NodeKind;
  depth: number;
  estimatedRows: SizeBucket;
  actualRows: SizeBucket;
  elapsed: TimeBucket;
  sharedReads: SizeBucket;
  hasFilter: boolean;
  hasIndex: boolean;
  estimateMismatch: "unknown" | "low" | "medium" | "high";
}

export interface PlanSummary {
  version: 1;
  analyzed: boolean;
  truncated: boolean;
  nodes: PlanSummaryNode[];
}

function sizeBucket(value: unknown): SizeBucket {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "none";
  if (value < 2) return "1";
  if (value < 10) return "2-9";
  if (value < 100) return "10-99";
  if (value < 1000) return "100-999";
  if (value < 10000) return "1k-9k";
  return "10k+";
}

function timeBucket(value: unknown): TimeBucket {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "unknown";
  if (value < 1) return "<1ms";
  if (value < 10) return "1-9ms";
  if (value < 100) return "10-99ms";
  if (value < 1000) return "100-999ms";
  return "1s+";
}

function nodeKind(value: unknown): NodeKind {
  if (typeof value !== "string") return "other";
  const normalized = value.toLowerCase();
  if (normalized.includes("bitmap")) return "bitmap_scan";
  if (normalized.includes("index") && normalized.includes("scan")) return "index_scan";
  if (normalized.includes("scan")) return "sequential_scan";
  if (normalized.includes("sort")) return "sort";
  if (normalized.includes("nested loop")) return "nested_loop";
  if (normalized.includes("merge join")) return "merge_join";
  if (normalized.includes("hash join")) return "hash_join";
  if (normalized.includes("hash")) return "hash";
  if (normalized.includes("aggregate")) return "aggregate";
  if (normalized.includes("limit")) return "limit";
  return "other";
}

function mismatch(estimated: unknown, actual: unknown): PlanSummaryNode["estimateMismatch"] {
  if (
    typeof estimated !== "number" ||
    typeof actual !== "number" ||
    !Number.isFinite(estimated) ||
    !Number.isFinite(actual) ||
    estimated < 0 ||
    actual < 0
  )
    return "unknown";
  const ratio = Math.max((actual + 1) / (estimated + 1), (estimated + 1) / (actual + 1));
  if (ratio >= 100) return "high";
  if (ratio >= 10) return "medium";
  return "low";
}

export function summarizeExplainPlan(plan: ExplainNode, analyzed: boolean): PlanSummary {
  const nodes: PlanSummaryNode[] = [];
  let truncated = false;
  const visit = (node: ExplainNode, depth: number) => {
    if (nodes.length >= 24) {
      truncated = true;
      return;
    }
    const kind = nodeKind(node["Node Type"]);
    nodes.push({
      kind,
      depth: Math.min(depth, 8),
      estimatedRows: sizeBucket(node["Plan Rows"]),
      actualRows: analyzed ? sizeBucket(node["Actual Rows"]) : "none",
      elapsed: analyzed ? timeBucket(node["Actual Total Time"]) : "unknown",
      sharedReads: analyzed ? sizeBucket(node["Shared Read Blocks"]) : "none",
      hasFilter: Boolean(node.Filter || node["Index Cond"] || node["Hash Cond"]),
      hasIndex: Boolean(node["Index Name"]) || kind === "index_scan" || kind === "bitmap_scan",
      estimateMismatch: analyzed ? mismatch(node["Plan Rows"], node["Actual Rows"]) : "unknown",
    });
    for (const child of Array.isArray(node.Plans) ? node.Plans : []) visit(child, depth + 1);
  };
  visit(plan, 0);
  return { version: 1, analyzed, truncated, nodes };
}
