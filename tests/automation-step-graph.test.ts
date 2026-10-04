import { describe, expect, test } from "bun:test";
import { newStep } from "../src/lib/automation/defaults";
import {
  addId,
  buildStepGraph,
  entryId,
  moveToInsert,
  resetConnection,
  resolveConnection,
  START_ID,
  terminalId,
} from "../src/lib/automation/step-graph";
import type { ActionType, Step } from "../src/lib/db/automation";

function step(id: string, type: ActionType = "log", patch: Partial<Step> = {}): Step {
  return { ...newStep(type), id, name: id, ...patch };
}

function loop(id: string, steps: Step[]): Step {
  const base = step(id, "loop");
  if (base.action.type !== "loop") throw new Error("loop");
  return { ...base, action: { ...base.action, steps } };
}

function condition(id: string): Step {
  const base = step(id, "condition");
  if (base.action.type !== "condition") throw new Error("condition");
  const then: Step["onSuccess"] = { type: "next" };
  return { ...base, action: { ...base.action, then, otherwise: { type: "goto", stepId: "d" } } };
}

const edge = (graph: ReturnType<typeof buildStepGraph>, id: string) =>
  graph.edges.find((entry) => entry.id === id);

describe("step graph projection", () => {
  test("empty task connects start to the success terminal with an insert point", () => {
    const graph = buildStepGraph([]);
    expect(graph.nodes.map((node) => node.kind)).toEqual(["start", "end_success", "end_failure"]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      source: START_ID,
      target: terminalId(null, "end_success"),
      insert: { parentId: null, index: 0 },
    });
  });

  test("sequence, goto, failure path and terminals", () => {
    const steps = [
      step("a", "sql", { onFailure: { type: "goto", stepId: "c" } }),
      step("b", "export", { onSuccess: { type: "goto", stepId: "a" } }),
      step("c", "log", { onSuccess: { type: "end_failure" } }),
      step("d", "fail"),
    ];
    const graph = buildStepGraph(steps);
    expect(edge(graph, `${START_ID}->a`)?.insert).toEqual({ parentId: null, index: 0 });
    expect(edge(graph, "a:success")).toMatchObject({ target: "b", role: "sequence", label: null });
    expect(edge(graph, "a:failure")).toMatchObject({
      target: "c",
      role: "goto",
      label: "Bei Fehler",
      deletable: true,
    });
    expect(edge(graph, "b:success")).toMatchObject({ target: "a", role: "goto", label: "Gehe zu" });
    expect(edge(graph, "b:failure")).toBeUndefined();
    expect(edge(graph, "c:success")).toMatchObject({
      target: terminalId(null, "end_failure"),
      role: "end",
      deletable: true,
    });
    expect(edge(graph, "d:success")).toBeUndefined();
    expect(edge(graph, "d:failure")).toMatchObject({
      target: terminalId(null, "end_failure"),
      deletable: false,
    });
    expect(graph.nodes.find((node) => node.id === "c")?.number).toBe("3");
  });

  test("conditions branch into yes and no", () => {
    const graph = buildStepGraph([condition("c"), step("x"), step("d")]);
    expect(edge(graph, "c:yes")).toMatchObject({ target: "x", label: "Ja", role: "sequence" });
    expect(edge(graph, "c:no")).toMatchObject({ target: "d", label: "Nein", role: "goto" });
    expect(edge(graph, "c:success")).toBeUndefined();
    expect(edge(graph, "d:success")?.insert).toEqual({ parentId: null, index: 3 });
  });

  test("loops become groups with entry, add point and own terminals", () => {
    const inner = [step("i1", "sql", { onFailure: { type: "end_success" } }), step("i2")];
    const graph = buildStepGraph([loop("L", inner), step("z")]);
    const children = graph.nodes.filter((node) => node.parentId === "L").map((node) => node.id);
    expect(children).toEqual([
      entryId("L"),
      "i1",
      "i2",
      addId("L"),
      terminalId("L", "end_success"),
    ]);
    expect(graph.nodes.find((node) => node.id === "L")?.kind).toBe("loop");
    expect(graph.nodes.find((node) => node.id === "i2")?.number).toBe("1.2");
    expect(edge(graph, `${entryId("L")}->i1`)?.insert).toEqual({ parentId: "L", index: 0 });
    expect(edge(graph, "i2:success")).toMatchObject({
      target: addId("L"),
      insert: { parentId: "L", index: 2 },
    });
    expect(edge(graph, "i1:failure")?.target).toBe(terminalId("L", "end_success"));
    expect(edge(graph, "L:success")?.target).toBe("z");
  });
});

describe("graph edits write back to the model", () => {
  const base = () => [step("a"), step("b"), step("c"), loop("L", [step("i1"), step("i2")])];

  test("dragging from the failure handle sets goto, next or end flows", () => {
    const toC = resolveConnection(base(), "a", "failure", "c");
    expect("steps" in toC && toC.steps[0].onFailure).toEqual({ type: "goto", stepId: "c" });
    const toNext = resolveConnection(base(), "a", "failure", "b");
    expect("steps" in toNext && toNext.steps[0].onFailure).toEqual({ type: "next" });
    const toEnd = resolveConnection(base(), "b", "success", terminalId(null, "end_success"));
    expect("steps" in toEnd && toEnd.steps[1].onSuccess).toEqual({ type: "end_success" });
  });

  test("condition handles write then and otherwise", () => {
    const steps = [condition("k"), step("b"), step("d")];
    const result = resolveConnection(steps, "k", "yes", "d");
    if (!("steps" in result)) throw new Error(result.error);
    const action = result.steps[0].action;
    expect(action.type === "condition" && action.then).toEqual({ type: "goto", stepId: "d" });
    const reset = resetConnection(result.steps, "k", "no");
    const after = reset[0].action;
    expect(after.type === "condition" && after.otherwise).toEqual({ type: "end_success" });
  });

  test("connections across levels or to self are rejected", () => {
    expect(resolveConnection(base(), "a", "failure", "i1")).toEqual({
      error: "Sprungziele müssen auf derselben Ebene liegen.",
    });
    expect("error" in resolveConnection(base(), "a", "success", "a")).toBe(true);
    const inner = resolveConnection(base(), "i1", "failure", addId("L"));
    if (!("steps" in inner)) throw new Error(inner.error);
    const nested = inner.steps[3].action;
    expect(nested.type === "loop" && nested.steps[0].onFailure).toEqual({ type: "end_success" });
  });

  test("deleting an edge resets to the default flow", () => {
    const steps = [step("a", "log", { onFailure: { type: "goto", stepId: "c" } }), step("c")];
    expect(resetConnection(steps, "a", "failure")[0].onFailure).toEqual({ type: "end_failure" });
    const jumped = [step("a", "log", { onSuccess: { type: "goto", stepId: "c" } }), step("c")];
    expect(resetConnection(jumped, "a", "success")[0].onSuccess).toEqual({ type: "next" });
  });

  test("dropping a node onto an edge moves it there", () => {
    const ids = (steps: Step[]) => steps.map((entry) => entry.id);
    expect(ids(moveToInsert(base(), "a", { parentId: null, index: 3 }) ?? [])).toEqual([
      "b",
      "c",
      "a",
      "L",
    ]);
    expect(ids(moveToInsert(base(), "c", { parentId: null, index: 0 }) ?? [])).toEqual([
      "c",
      "a",
      "b",
      "L",
    ]);
    expect(moveToInsert(base(), "a", { parentId: null, index: 1 })).toBeNull();
    const into = moveToInsert(base(), "b", { parentId: "L", index: 1 }) ?? [];
    expect(ids(into)).toEqual(["a", "c", "L"]);
    const nested = into[2].action;
    expect(nested.type === "loop" && ids(nested.steps)).toEqual(["i1", "b", "i2"]);
    expect(moveToInsert(base(), "L", { parentId: "L", index: 0 })).toBeNull();
  });
});
