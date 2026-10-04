import type { ElkNode } from "elkjs/lib/elk-api.js";
import ELK from "elkjs/lib/elk-api.js";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import type { StepGraph, StepGraphNode } from "@/lib/automation/step-graph";
import {
  LOOP_HEADER,
  LOOP_LANE_PADDING,
  LOOP_PADDING,
  SMALL_HEIGHT,
  SMALL_WIDTH,
  START_LINE,
  STEP_HEIGHT,
  STEP_WIDTH,
} from "./step-graph-types";

const elk = new ELK({ workerUrl: elkWorkerUrl });

export interface GraphBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function startHeight(lines: number): number {
  return 34 + START_LINE * Math.max(1, Math.min(lines, 3));
}

export function startLines(scheduleCount: number): number {
  return Math.max(1, Math.min(scheduleCount, 3));
}

function size(node: StepGraphNode, startLines: number) {
  if (node.kind === "step") return { width: STEP_WIDTH, height: STEP_HEIGHT };
  if (node.kind === "start") return { width: STEP_WIDTH, height: startHeight(startLines) };
  return { width: SMALL_WIDTH, height: SMALL_HEIGHT };
}

const LAYERED = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.spacing.nodeNode": "40",
  "elk.layered.spacing.nodeNodeBetweenLayers": "44",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
};

function anchors(graph: StepGraph) {
  return graph.nodes
    .filter((node) => node.kind === "end_success" || node.kind === "end_failure")
    .flatMap((node) => {
      const last = graph.nodes
        .filter(
          (entry) =>
            entry.parentId === node.parentId && (entry.kind === "step" || entry.kind === "loop"),
        )
        .at(-1);
      const source = last?.id ?? (node.parentId ? null : "__start");
      return source ? [{ id: `anchor:${node.id}`, sources: [source], targets: [node.id] }] : [];
    });
}

function alignTerminals(graph: StepGraph, boxes: Map<string, GraphBox>) {
  const last = graph.nodes
    .filter((node) => node.parentId === null && (node.kind === "step" || node.kind === "loop"))
    .at(-1);
  const anchorId = last?.id ?? "__start";
  const anchor = boxes.get(anchorId);
  const success = boxes.get("__end_success");
  const failure = boxes.get("__end_failure");
  const linked = graph.edges.some(
    (edge) => edge.source === anchorId && edge.target === "__end_success",
  );
  if (!anchor || !success || !linked) return;
  const shift = anchor.x + anchor.width / 2 - (success.x + success.width / 2);
  success.x += shift;
  if (failure && failure.y === success.y) failure.x += shift;
}

export async function layoutStepGraph(
  graph: StepGraph,
  startLines: number,
): Promise<Map<string, GraphBox>> {
  const build = (parentId: string | null): ElkNode[] =>
    graph.nodes
      .filter((node) => node.parentId === parentId)
      .map((node) =>
        node.kind === "loop"
          ? {
              id: node.id,
              layoutOptions: {
                ...LAYERED,
                "elk.spacing.nodeNode": "28",
                "elk.layered.spacing.nodeNodeBetweenLayers": "32",
                "elk.padding": `[top=${LOOP_HEADER},left=${LOOP_PADDING},bottom=${LOOP_PADDING},right=${LOOP_LANE_PADDING}]`,
                "elk.nodeSize.constraints": "MINIMUM_SIZE",
                "elk.nodeSize.minimum": `(${STEP_WIDTH + LOOP_PADDING + LOOP_LANE_PADDING},${LOOP_HEADER + 80})`,
              },
              children: build(node.id),
            }
          : { id: node.id, ...size(node, startLines) },
      );
  const laid = await elk.layout({
    id: "root",
    layoutOptions: {
      ...LAYERED,
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.padding": "[top=24,left=24,bottom=24,right=24]",
    },
    children: build(null),
    edges: [
      ...graph.edges
        .filter((edge) => edge.role !== "goto")
        .map((edge) => ({
          id: edge.id,
          sources: [edge.source],
          targets: [edge.target],
          layoutOptions: {
            "elk.layered.priority.straightness": edge.role === "sequence" ? "10" : "1",
          },
        })),
      ...anchors(graph),
    ],
  });
  const boxes = new Map<string, GraphBox>();
  const visit = (nodes: ElkNode[] | undefined) => {
    for (const node of nodes ?? []) {
      boxes.set(node.id, {
        x: node.x ?? 0,
        y: node.y ?? 0,
        width: node.width ?? STEP_WIDTH,
        height: node.height ?? STEP_HEIGHT,
      });
      visit(node.children);
    }
  };
  visit(laid.children);
  alignTerminals(graph, boxes);
  return boxes;
}

export function edgeLanes(graph: StepGraph, boxes: Map<string, GraphBox>): Map<string, number> {
  const parents = new Map(graph.nodes.map((node) => [node.id, node.parentId]));
  const ancestors = (id: string) => {
    const result = new Set<string>([id]);
    let cursor = parents.get(id);
    while (cursor) {
      result.add(cursor);
      cursor = parents.get(cursor);
    }
    return result;
  };
  const lanes = new Map<string, number>();
  const taken: { top: number; bottom: number; x: number }[] = [];
  for (const edge of graph.edges) {
    const source = boxes.get(edge.source);
    const target = boxes.get(edge.target);
    if (!source || !target) continue;
    const skip = new Set([...ancestors(edge.source), ...ancestors(edge.target)]);
    const top = Math.min(source.y + source.height, target.y);
    const bottom = Math.max(source.y, target.y);
    const columns = [source.x + source.width / 2, target.x + target.width / 2];
    const between = [...boxes]
      .filter(([id, box]) => !skip.has(id) && box.y < bottom && box.y + box.height > top)
      .map(([, box]) => box);
    const blocked = between.some((box) =>
      columns.some((x) => x > box.x - 6 && x < box.x + box.width + 6),
    );
    if (!blocked && target.y >= source.y + source.height) continue;
    let x =
      Math.max(
        source.x + source.width,
        target.x + target.width,
        ...between.map((box) => box.x + box.width),
      ) + 22;
    while (taken.some((lane) => Math.abs(lane.x - x) < 8 && lane.top < bottom && lane.bottom > top))
      x += 12;
    taken.push({ top, bottom, x });
    lanes.set(edge.id, x);
  }
  return lanes;
}
