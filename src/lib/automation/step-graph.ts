import type { Flow, Step } from "@/lib/db/automation";
import { flattenSteps, insertStep, mapLevel, removeStep } from "./step-tree";

export type GraphNodeKind =
  | "start"
  | "step"
  | "loop"
  | "entry"
  | "add"
  | "end_success"
  | "end_failure";
export type GraphHandle = "success" | "failure" | "yes" | "no";
export type GraphEdgeRole = "sequence" | "goto" | "end";

export interface GraphInsert {
  parentId: string | null;
  index: number;
}

export interface StepGraphNode {
  id: string;
  kind: GraphNodeKind;
  parentId: string | null;
  step: Step | null;
  number: string | null;
  index: number;
}

export interface StepGraphEdge {
  id: string;
  source: string;
  target: string;
  handle: GraphHandle;
  role: GraphEdgeRole;
  label: string | null;
  insert: GraphInsert | null;
  deletable: boolean;
}

export interface StepGraph {
  nodes: StepGraphNode[];
  edges: StepGraphEdge[];
}

export const START_ID = "__start";

export function terminalId(parentId: string | null, kind: "end_success" | "end_failure"): string {
  return parentId ? `${parentId}__${kind}` : `__${kind}`;
}

export function addId(parentId: string): string {
  return `${parentId}__add`;
}

export function entryId(parentId: string): string {
  return `${parentId}__entry`;
}

const HANDLE_LABEL: Record<GraphHandle, string | null> = {
  success: null,
  failure: "Bei Fehler",
  yes: "Ja",
  no: "Nein",
};

const DEFAULT_FLOW: Record<GraphHandle, Flow["type"]> = {
  success: "next",
  failure: "end_failure",
  yes: "next",
  no: "end_success",
};

export function flowFor(step: Step, handle: GraphHandle): Flow {
  if (handle === "failure") return step.onFailure;
  if (handle === "success") return step.onSuccess;
  if (step.action.type !== "condition") return { type: "next" };
  return handle === "yes" ? step.action.then : step.action.otherwise;
}

export function handlesFor(step: Step): GraphHandle[] {
  if (step.action.type === "condition") return ["yes", "no", "failure"];
  if (step.action.type === "fail") return ["failure"];
  return ["success", "failure"];
}

function levelEnd(parentId: string | null): string {
  return parentId ? addId(parentId) : terminalId(null, "end_success");
}

function buildLevel(
  steps: Step[],
  parentId: string | null,
  prefix: string,
  graph: StepGraph,
): void {
  const used = new Set<string>();
  const firstTarget = steps[0]?.id ?? levelEnd(parentId);
  const entry = parentId ? entryId(parentId) : START_ID;
  if (parentId) graph.nodes.push(node(entry, "entry", parentId, null, null, -1));
  graph.edges.push({
    id: `${entry}->${firstTarget}`,
    source: entry,
    target: firstTarget,
    handle: "success",
    role: "sequence",
    label: null,
    insert: { parentId, index: 0 },
    deletable: false,
  });

  steps.forEach((step, index) => {
    const number = `${prefix}${index + 1}`;
    const kind = step.action.type === "loop" ? "loop" : "step";
    graph.nodes.push(node(step.id, kind, parentId, step, number, index));
    for (const handle of handlesFor(step)) {
      const flow = flowFor(step, handle);
      const fallback = handle === "failure" && step.action.type !== "fail";
      if (fallback && flow.type === "end_failure") continue;
      const nextId = steps[index + 1]?.id ?? levelEnd(parentId);
      let target: string;
      let role: GraphEdgeRole = "end";
      let insert: GraphInsert | null = null;
      if (flow.type === "next") {
        target = nextId;
        role = "sequence";
        insert = handle === "failure" ? null : { parentId, index: index + 1 };
      } else if (flow.type === "goto") {
        if (!steps.some((entry) => entry.id === flow.stepId)) continue;
        target = flow.stepId;
        role = "goto";
      } else {
        target = terminalId(parentId, flow.type);
        used.add(flow.type);
      }
      const label =
        role === "goto" && handle === "success" ? "Gehe zu" : (HANDLE_LABEL[handle] ?? null);
      graph.edges.push({
        id: `${step.id}:${handle}`,
        source: step.id,
        target,
        handle,
        role,
        label,
        insert,
        deletable: flow.type !== DEFAULT_FLOW[handle] && step.action.type !== "fail",
      });
    }
    if (step.action.type === "loop") {
      buildLevel(step.action.steps, step.id, `${number}.`, graph);
    }
  });

  if (parentId) {
    graph.nodes.push(node(addId(parentId), "add", parentId, null, null, steps.length));
    for (const kind of ["end_success", "end_failure"] as const)
      if (used.has(kind))
        graph.nodes.push(node(terminalId(parentId, kind), kind, parentId, null, null, -1));
  }
}

function node(
  id: string,
  kind: GraphNodeKind,
  parentId: string | null,
  step: Step | null,
  number: string | null,
  index: number,
): StepGraphNode {
  return { id, kind, parentId, step, number, index };
}

export function buildStepGraph(steps: Step[]): StepGraph {
  const graph: StepGraph = { nodes: [node(START_ID, "start", null, null, null, -1)], edges: [] };
  buildLevel(steps, null, "", graph);
  graph.nodes.push(node(terminalId(null, "end_success"), "end_success", null, null, null, -1));
  graph.nodes.push(node(terminalId(null, "end_failure"), "end_failure", null, null, null, -1));
  return graph;
}

function setFlow(step: Step, handle: GraphHandle, flow: Flow): Step {
  if (handle === "success") return { ...step, onSuccess: flow };
  if (handle === "failure") return { ...step, onFailure: flow };
  if (step.action.type !== "condition") return step;
  return {
    ...step,
    action: { ...step.action, [handle === "yes" ? "then" : "otherwise"]: flow },
  };
}

function replaceStep(steps: Step[], parentId: string | null, next: Step): Step[] {
  return mapLevel(steps, parentId, (level) =>
    level.map((entry) => (entry.id === next.id ? next : entry)),
  );
}

export type ConnectResult = { steps: Step[] } | { error: string };

export function resolveConnection(
  steps: Step[],
  sourceId: string,
  handle: GraphHandle,
  targetId: string,
): ConnectResult {
  const flat = flattenSteps(steps);
  const source = flat.find((entry) => entry.step.id === sourceId);
  if (!source) return { error: "Schritt nicht gefunden." };
  if (!handlesFor(source.step).includes(handle)) return { error: "Diesen Ausgang gibt es nicht." };
  const parentId = source.parentId;
  let flow: Flow | null = null;
  if (targetId === terminalId(parentId, "end_success")) flow = { type: "end_success" };
  else if (targetId === terminalId(parentId, "end_failure")) flow = { type: "end_failure" };
  else if (parentId && targetId === addId(parentId)) flow = { type: "end_success" };
  else {
    const target = flat.find((entry) => entry.step.id === targetId);
    if (!target) return { error: "Hierhin kann kein Ablauf zeigen." };
    if (target.parentId !== parentId)
      return { error: "Sprungziele müssen auf derselben Ebene liegen." };
    if (target.step.id === sourceId)
      return { error: "Ein Schritt kann nicht auf sich selbst zeigen." };
    flow =
      target.index === source.index + 1
        ? { type: "next" }
        : { type: "goto", stepId: target.step.id };
  }
  return { steps: replaceStep(steps, parentId, setFlow(source.step, handle, flow)) };
}

export function resetConnection(steps: Step[], sourceId: string, handle: GraphHandle): Step[] {
  const source = flattenSteps(steps).find((entry) => entry.step.id === sourceId);
  if (!source) return steps;
  const flow = { type: DEFAULT_FLOW[handle] } as Flow;
  return replaceStep(steps, source.parentId, setFlow(source.step, handle, flow));
}

export function moveToInsert(steps: Step[], stepId: string, insert: GraphInsert): Step[] | null {
  const flat = flattenSteps(steps);
  const source = flat.find((entry) => entry.step.id === stepId);
  if (!source) return null;
  if (insert.parentId) {
    let cursor = flat.find((entry) => entry.step.id === insert.parentId);
    while (cursor) {
      if (cursor.step.id === stepId) return null;
      const parent = cursor.parentId;
      cursor = parent ? flat.find((entry) => entry.step.id === parent) : undefined;
    }
  }
  let index = insert.index;
  if (source.parentId === insert.parentId) {
    if (index === source.index || index === source.index + 1) return null;
    if (index > source.index) index -= 1;
  }
  return insertStep(removeStep(steps, stepId), insert.parentId, index, source.step);
}
