import {
  AGG_LABEL,
  type Agg,
  aggSql,
  bucketExpr,
  createId,
  type DatasetShape,
  DIM_KEY,
  DIM2_KEY,
  dateLiteral,
  metricKey,
  type Period,
  periodStart,
  type SortMode,
  type TimeBucket,
} from "@/lib/dashboards";
import type { DatabaseKind } from "@/lib/db";
import { identifierStyleForKind, quoteIdentifier } from "@/lib/export";
import { compileConditionExpression } from "@/lib/sql-filter";

export type FlowNodeType = "source" | "join" | "filter" | "aggregate" | "sort" | "output";

export interface FlowCondition {
  id: string;
  ref: string;
  operator: string;
  value: string;
}

export interface FlowMetric {
  id: string;
  agg: Agg;
  ref: string | null;
  label: string;
}

export type FlowNodeData =
  | { type: "source"; schema: string; table: string }
  | {
      type: "join";
      schema: string;
      table: string;
      joinType: "LEFT" | "INNER";
      fromRef: string;
      toColumn: string;
    }
  | { type: "filter"; conditions: FlowCondition[] }
  | {
      type: "aggregate";
      dimension: { ref: string; bucket: TimeBucket } | null;
      dimension2: string | null;
      metrics: FlowMetric[];
    }
  | { type: "sort"; sort: SortMode; limit: number }
  | { type: "output"; dimension: string | null; values: string[]; dateColumn: string | null };

export interface FlowNode {
  id: string;
  position: { x: number; y: number };
  data: FlowNodeData;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export const FLOW_NODE_LABEL: Record<FlowNodeType, string> = {
  source: "Quelle",
  join: "Verknüpfung",
  filter: "Bedingung",
  aggregate: "Gruppierung",
  sort: "Sortierung",
  output: "Ausgabe",
};

export const NODE_GAP = 230;

export function defaultNodeData(type: FlowNodeType): FlowNodeData {
  switch (type) {
    case "source":
      return { type, schema: "", table: "" };
    case "join":
      return { type, schema: "", table: "", joinType: "LEFT", fromRef: "", toColumn: "" };
    case "filter":
      return { type, conditions: [{ id: createId(), ref: "", operator: "eq", value: "" }] };
    case "aggregate":
      return {
        type,
        dimension: null,
        dimension2: null,
        metrics: [{ id: createId(), agg: "count", ref: null, label: "Anzahl" }],
      };
    case "sort":
      return { type, sort: "dimension", limit: 50 };
    case "output":
      return { type, dimension: null, values: [], dateColumn: null };
  }
}

export function defaultFlow(): FlowGraph {
  const source = createId();
  const output = createId();
  return {
    nodes: [
      { id: source, position: { x: 0, y: 0 }, data: defaultNodeData("source") },
      { id: output, position: { x: NODE_GAP, y: 0 }, data: defaultNodeData("output") },
    ],
    edges: [{ id: createId(), source, target: output }],
  };
}

export function flowChain(flow: FlowGraph): FlowNode[] {
  const output = flow.nodes.find((n) => n.data.type === "output");
  if (!output) return [];
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const incoming = new Map(flow.edges.map((e) => [e.target, e.source]));
  const chain: FlowNode[] = [output];
  const seen = new Set([output.id]);
  let current = output.id;
  while (incoming.has(current)) {
    const prev = incoming.get(current) as string;
    if (seen.has(prev)) break;
    const node = byId.get(prev);
    if (!node) break;
    chain.unshift(node);
    seen.add(prev);
    current = prev;
  }
  return chain;
}

export function insertNode(flow: FlowGraph, type: FlowNodeType): FlowGraph {
  const chain = flowChain(flow);
  const output = chain[chain.length - 1];
  const prev = chain[chain.length - 2];
  const node: FlowNode = { id: createId(), position: { x: 0, y: 0 }, data: defaultNodeData(type) };
  if (!output || !prev) return { ...flow, nodes: [...flow.nodes, node] };
  const edges = flow.edges
    .filter((e) => !(e.source === prev.id && e.target === output.id))
    .concat([
      { id: createId(), source: prev.id, target: node.id },
      { id: createId(), source: node.id, target: output.id },
    ]);
  return relayout({ nodes: [...flow.nodes, node], edges });
}

export function removeNode(flow: FlowGraph, id: string): FlowGraph {
  const node = flow.nodes.find((n) => n.id === id);
  if (!node || node.data.type === "source" || node.data.type === "output") return flow;
  const before = flow.edges.find((e) => e.target === id)?.source;
  const after = flow.edges.find((e) => e.source === id)?.target;
  const edges = flow.edges.filter((e) => e.source !== id && e.target !== id);
  if (before && after && !edges.some((e) => e.source === before && e.target === after))
    edges.push({ id: createId(), source: before, target: after });
  return relayout({
    nodes: flow.nodes.filter((n) => n.id !== id).map((n) => pruneRefs(n, id)),
    edges,
  });
}

function pruneRefs(node: FlowNode, gone: string): FlowNode {
  const dead = (ref: string | null | undefined) =>
    Boolean(ref) && splitRef(ref as string).nodeId === gone;
  const d = node.data;
  switch (d.type) {
    case "join":
      return dead(d.fromRef) ? { ...node, data: { ...d, fromRef: "" } } : node;
    case "filter":
      return {
        ...node,
        data: { ...d, conditions: d.conditions.map((c) => (dead(c.ref) ? { ...c, ref: "" } : c)) },
      };
    case "aggregate":
      return {
        ...node,
        data: {
          ...d,
          dimension: d.dimension && dead(d.dimension.ref) ? null : d.dimension,
          dimension2: dead(d.dimension2) ? null : d.dimension2,
          metrics: d.metrics.map((m) => (dead(m.ref) ? { ...m, ref: null } : m)),
        },
      };
    case "output":
      return {
        ...node,
        data: {
          ...d,
          dimension: dead(d.dimension) ? null : d.dimension,
          values: d.values.filter((v) => !dead(v)),
          dateColumn: dead(d.dateColumn) ? null : d.dateColumn,
        },
      };
    default:
      return node;
  }
}

export function relayout(flow: FlowGraph): FlowGraph {
  const chain = flowChain(flow);
  const index = new Map(chain.map((n, i) => [n.id, i]));
  let loose = 0;
  return {
    ...flow,
    nodes: flow.nodes.map((n) => {
      const i = index.get(n.id);
      if (i !== undefined) return { ...n, position: { x: i * NODE_GAP, y: 0 } };
      loose += 1;
      return { ...n, position: { x: (loose - 1) * NODE_GAP, y: 140 } };
    }),
  };
}

export function updateNodeData(flow: FlowGraph, id: string, data: FlowNodeData): FlowGraph {
  return { ...flow, nodes: flow.nodes.map((n) => (n.id === id ? { ...n, data } : n)) };
}

export function makeRef(nodeId: string, column: string): string {
  return `${nodeId}:${column}`;
}

export function splitRef(ref: string): { nodeId: string; column: string } {
  const i = ref.indexOf(":");
  return { nodeId: ref.slice(0, i), column: ref.slice(i + 1) };
}

export function tableNodes(chain: FlowNode[]): FlowNode[] {
  return chain.filter((n) => n.data.type === "source" || n.data.type === "join");
}

export function aliasFor(chain: FlowNode[], nodeId: string): string {
  return `t${tableNodes(chain).findIndex((n) => n.id === nodeId) + 1}`;
}

export function refLabelIn(chain: FlowNode[], ref: string): string {
  const { nodeId, column } = splitRef(ref);
  const node = chain.find((n) => n.id === nodeId);
  const table = node && "table" in node.data ? node.data.table : "?";
  return `${table}.${column}`;
}

function refExpr(chain: FlowNode[], ref: string, kind: DatabaseKind | null): string {
  const { nodeId, column } = splitRef(ref);
  const style = identifierStyleForKind(kind);
  const tables = tableNodes(chain);
  const q = quoteIdentifier(column, style);
  return tables.length > 1 ? `${aliasFor(chain, nodeId)}.${q}` : q;
}

export function flowProblem(flow: FlowGraph): string | null {
  const chain = flowChain(flow);
  const source = chain[0];
  if (!source || source.data.type !== "source") return "Die Kette muss mit einer Quelle beginnen";
  if (!source.data.table) return "Wähle in der Quelle eine Tabelle";
  for (const n of chain) {
    if (n.data.type === "join" && (!n.data.table || !n.data.fromRef || !n.data.toColumn))
      return "Die Verknüpfung braucht Tabelle und beide Spalten";
  }
  return null;
}

export function buildFlowSql(flow: FlowGraph, kind: DatabaseKind | null, period: Period): string {
  if (flowProblem(flow)) return "";
  const chain = flowChain(flow);
  const style = identifierStyleForKind(kind);
  const q = (name: string) => quoteIdentifier(name, style);
  const table = (schema: string, name: string) => (schema ? `${q(schema)}.${q(name)}` : q(name));
  const tables = tableNodes(chain);
  const multi = tables.length > 1;
  const source = chain[0].data as Extract<FlowNodeData, { type: "source" }>;
  const aggregate = chain.find((n) => n.data.type === "aggregate")?.data as
    | Extract<FlowNodeData, { type: "aggregate" }>
    | undefined;
  const output = chain[chain.length - 1].data as Extract<FlowNodeData, { type: "output" }>;
  const sortNode = chain.find((n) => n.data.type === "sort")?.data as
    | Extract<FlowNodeData, { type: "sort" }>
    | undefined;
  const select: string[] = [];
  const groups: string[] = [];
  let metricCount = 0;
  let grouped = false;
  let hasDimension = false;
  if (aggregate) {
    const metrics = aggregate.metrics.filter((m) => m.agg === "count" || m.ref);
    if (aggregate.dimension) {
      const expr = bucketExpr(
        refExpr(chain, aggregate.dimension.ref, kind),
        aggregate.dimension.bucket,
        kind,
      );
      select.push(`${expr} AS ${q(DIM_KEY)}`);
      groups.push(expr);
      hasDimension = true;
    }
    if (aggregate.dimension2) {
      const expr = refExpr(chain, aggregate.dimension2, kind);
      select.push(`${expr} AS ${q(DIM2_KEY)}`);
      groups.push(expr);
    }
    select.push(
      ...metrics.map(
        (m, i) =>
          `${aggSql(m.agg, m.ref ? refExpr(chain, m.ref, kind) : "*")} AS ${q(metricKey(i))}`,
      ),
    );
    metricCount = metrics.length;
    grouped = metrics.some((m) => m.agg !== "none") && groups.length > 0;
    if (grouped)
      groups.push(
        ...metrics
          .filter((m) => m.agg === "none" && m.ref)
          .map((m) => refExpr(chain, m.ref as string, kind)),
      );
  } else {
    if (output.dimension) {
      select.push(`${refExpr(chain, output.dimension, kind)} AS ${q(DIM_KEY)}`);
      hasDimension = true;
    }
    select.push(
      ...output.values.map((ref, i) => `${refExpr(chain, ref, kind)} AS ${q(metricKey(i))}`),
    );
    metricCount = output.values.length;
  }
  if (select.length === 0) select.push(multi ? "t1.*" : "*");
  const limit = Math.max(1, Math.floor(sortNode?.limit || 50));
  const lines = [`SELECT ${kind === "mssql" ? `TOP ${limit} ` : ""}${select.join(", ")}`];
  lines.push(`FROM ${table(source.schema, source.table)}${multi ? " AS t1" : ""}`);
  for (const n of chain) {
    if (n.data.type !== "join") continue;
    const alias = aliasFor(chain, n.id);
    const from = refExpr(chain, n.data.fromRef, kind);
    lines.push(
      `${n.data.joinType} JOIN ${table(n.data.schema, n.data.table)} AS ${alias} ON ${alias}.${q(n.data.toColumn)} = ${from}`,
    );
  }
  const where: string[] = [];
  for (const n of chain) {
    if (n.data.type !== "filter") continue;
    for (const c of n.data.conditions) {
      if (!c.ref) continue;
      const part = compileConditionExpression(
        refExpr(chain, c.ref, kind),
        c.operator,
        c.value,
        kind,
      );
      if (part) where.push(part);
    }
  }
  const start = periodStart(period);
  if (output.dateColumn && start)
    where.push(`${refExpr(chain, output.dateColumn, kind)} >= ${dateLiteral(start, kind)}`);
  if (where.length) lines.push(`WHERE ${where.join(" AND ")}`);
  if (grouped) lines.push(`GROUP BY ${groups.join(", ")}`);
  const sort = sortNode?.sort ?? "dimension";
  const orderTarget =
    sort === "dimension"
      ? hasDimension && grouped
        ? q(DIM_KEY)
        : null
      : metricCount
        ? q(metricKey(0))
        : null;
  if (orderTarget) lines.push(`ORDER BY ${orderTarget} ${sort === "metric_desc" ? "DESC" : "ASC"}`);
  if (kind === "oracle") lines.push(`FETCH FIRST ${limit} ROWS ONLY`);
  else if (kind !== "mssql") lines.push(`LIMIT ${limit}`);
  return lines.join("\n");
}

export function flowShape(flow: FlowGraph): DatasetShape {
  const chain = flowChain(flow);
  const aggregate = chain.find((n) => n.data.type === "aggregate")?.data as
    | Extract<FlowNodeData, { type: "aggregate" }>
    | undefined;
  const output = chain[chain.length - 1]?.data as
    | Extract<FlowNodeData, { type: "output" }>
    | undefined;
  if (aggregate) {
    const metrics = aggregate.metrics.filter((m) => m.agg === "count" || m.ref);
    return {
      dimension: aggregate.dimension ? DIM_KEY : null,
      dimension2: aggregate.dimension2 ? DIM2_KEY : null,
      metrics: metrics.map((m, i) => ({
        key: metricKey(i),
        label:
          m.label || (m.ref ? `${AGG_LABEL[m.agg]} ${refLabelIn(chain, m.ref)}` : AGG_LABEL[m.agg]),
      })),
      hasDate: Boolean(output?.dateColumn),
    };
  }
  return {
    dimension: output?.dimension ? DIM_KEY : null,
    dimension2: null,
    metrics: (output?.values ?? []).map((ref, i) => ({
      key: metricKey(i),
      label: refLabelIn(chain, ref),
    })),
    hasDate: Boolean(output?.dateColumn),
  };
}
