import { describe, expect, test } from "bun:test";
import { newStep, newTask } from "../src/lib/automation/defaults";
import { findPlaceholders, unsafeSqlPlaceholders } from "../src/lib/automation/placeholders";
import { ACTION_TYPES, STEP_CATALOG } from "../src/lib/automation/step-catalog";
import { insertStep, moveStep, removeStep } from "../src/lib/automation/step-tree";
import { TASK_TEMPLATES } from "../src/lib/automation/templates";
import { isConnectionIssue, validateTask } from "../src/lib/automation/validation";
import type { Action, ActionType, Step, Task } from "../src/lib/db/automation";
import fixture from "../src-tauri/src/automation/fixtures/task-v1.json";

const EXPECTED_FIELDS: Record<ActionType, string[]> = {
  sql: ["connections", "sql"],
  export: ["connection", "source.sql"],
  backup: ["connection"],
  restore: ["connection", "path"],
  transfer: ["source", "target", "schemas"],
  table_copy: ["source", "target", "tables"],
  datagen: ["connection", "table"],
  import: ["connection", "table", "file"],
  compare: ["left.connection", "right.connection", "left.table", "right.table", "keyColumns"],
  check: ["connection", "check.table"],
  alert: ["connection", "sql"],
  shell: ["program"],
  http: ["url"],
  file_copy: ["from", "to"],
  file_move: ["from", "to"],
  file_delete: ["path"],
  mkdir: ["path"],
  file_exists: ["path"],
  zip: ["sources"],
  unzip: ["archive", "target"],
  cleanup: ["dir"],
  notify: [],
  wait: [],
  set_variable: ["name"],
  condition: ["left"],
  loop: ["over.values", "steps"],
  run_task: ["task"],
  log: ["message"],
  fail: ["message"],
};

const RECORD_FIELDS = new Set(["env", "headers", "vars", "options"]);

function allSteps(steps: Step[]): Step[] {
  return steps.flatMap((step) =>
    step.action.type === "loop" ? [step, ...allSteps(step.action.steps)] : [step],
  );
}

const fixtureActions = new Map<string, Action>();
for (const step of allSteps((fixture as Task).steps)) {
  if (!fixtureActions.has(step.action.type)) fixtureActions.set(step.action.type, step.action);
}

function shapeDiff(actual: unknown, expected: unknown, path: string): string[] {
  if (!actual || !expected || typeof actual !== "object" || typeof expected !== "object") return [];
  if (Array.isArray(actual) || Array.isArray(expected)) return [];
  const a = actual as Record<string, unknown>;
  const e = expected as Record<string, unknown>;
  if ("type" in a && "type" in e && a.type !== e.type) return [];
  const keysA = Object.keys(a).sort().join(",");
  const keysE = Object.keys(e).sort().join(",");
  const own = keysA === keysE ? [] : [`${path}: ${keysA} ≠ ${keysE}`];
  return [
    ...own,
    ...Object.keys(e)
      .filter((key) => !RECORD_FIELDS.has(key) && key !== "steps")
      .flatMap((key) => shapeDiff(a[key], e[key], `${path}.${key}`)),
  ];
}

describe("newStep", () => {
  test("catalog covers every action type of the fixture", () => {
    expect([...ACTION_TYPES].sort()).toEqual([...fixtureActions.keys()].sort());
  });

  test.each(ACTION_TYPES)("%s matches the Rust fixture shape", (type) => {
    const step = newStep(type);
    const reference = (fixture as Task).steps[0];
    expect(Object.keys(step).sort()).toEqual(Object.keys(reference).sort());
    expect(step.action.type).toBe(type);
    expect(step.name).toBe(STEP_CATALOG[type].label);
    expect(shapeDiff(step.action, fixtureActions.get(type), type)).toEqual([]);
  });

  test.each(ACTION_TYPES)("%s reports only the expected required fields", (type) => {
    const step = newStep(type);
    const task = { ...newTask("Test"), steps: [step] };
    const issues = validateTask(task).filter((issue) => issue.stepId === step.id);
    expect([...new Set(issues.map((issue) => issue.field))].sort()).toEqual(
      [...EXPECTED_FIELDS[type]].sort(),
    );
    for (const issue of issues) {
      expect(issue.severity).toBe(type === "loop" && issue.field === "steps" ? "warning" : "error");
    }
  });
});

describe("TASK_TEMPLATES", () => {
  test("has the seven contract templates", () => {
    expect(TASK_TEMPLATES.map((template) => template.name)).toEqual([
      "Nächtliches Backup mit Aufräumen",
      "Täglicher CSV-Bericht per E-Mail",
      "Abfrage-Alarm",
      "Datenqualität prüfen",
      "Tabelle spiegeln",
      "Skript auf allen Verbindungen mit Tag",
      "Webhook bei Fehler",
    ]);
  });

  test.each(TASK_TEMPLATES.map((template) => [template.name, template] as const))(
    "%s builds a valid task",
    (_name, template) => {
      const task = template.build();
      const errors = validateTask(task).filter((issue) => issue.severity === "error");
      expect(errors.filter((issue) => !isConnectionIssue(issue))).toEqual([]);
      expect(Object.keys(task).sort()).toEqual(Object.keys(fixture).sort());
      expect(task.enabled).toBe(false);
    },
  );

  test("builds fresh ids on every call", () => {
    for (const template of TASK_TEMPLATES) {
      const a = template.build();
      const b = template.build();
      expect(a.id).not.toBe(b.id);
      expect(allSteps(a.steps)[0].id).not.toBe(allSteps(b.steps)[0].id);
    }
  });

  test("contain no secrets", () => {
    for (const template of TASK_TEMPLATES) {
      const task = template.build();
      const json = JSON.stringify(task);
      expect(json).not.toMatch(/:\/\/|password|passwort|apikey|api_key|token|bearer|hooks\./i);
      expect(json).not.toMatch(/[\w.-]+@[\w-]+\.[a-z]{2,}/i);
      expect(task.variables.filter((variable) => variable.kind === "secret")).toEqual([]);
      for (const rule of task.notifications) {
        if (rule.channel.type === "email") expect(rule.channel.to).toEqual([]);
        if (rule.channel.type === "webhook") expect(rule.channel.webhookId).toBe("");
      }
    }
  });
});

describe("placeholders", () => {
  test("finds names, defaults and filters and skips escapes", () => {
    expect(findPlaceholders("a ${x:-1|upper} $${raw} ${step.2.rows}")).toEqual([
      { name: "x", fallback: "1", filter: "upper", start: 2, end: 15 },
      { name: "step.2.rows", fallback: null, filter: null, start: 24, end: 38 },
    ]);
  });

  test("unsafeSqlPlaceholders flags item and step values without |sql", () => {
    const sql =
      "SELECT * FROM t WHERE id = '${item.id}' AND n = ${step.1.value} AND x = '${item.name|sql}' AND d = '${date}' AND r = '${row.id}'";
    expect(unsafeSqlPlaceholders(sql)).toEqual(["item.id", "step.1.value"]);
    expect(unsafeSqlPlaceholders(sql, ["row"])).toEqual(["step.1.value", "row.id"]);
    expect(unsafeSqlPlaceholders("SELECT '${item.a|sql}'")).toEqual([]);
  });

  test("unknown variables are warnings, loop items are known", () => {
    const loop = newStep("loop");
    const inner = newStep("log");
    if (inner.action.type === "log") inner.action.message = "${row.id} ${missing}";
    if (loop.action.type === "loop") {
      loop.action.item = "row";
      loop.action.over = { type: "list", values: "a,b" };
      loop.action.steps = [inner];
    }
    const issues = validateTask({ ...newTask("t"), steps: [loop] });
    expect(issues.filter((issue) => issue.stepId === inner.id)).toEqual([
      {
        stepId: inner.id,
        field: "message",
        message: "Unbekannte Variable „missing“.",
        severity: "warning",
      },
    ]);
  });
});

describe("step tree", () => {
  test("moves, inserts and removes inside nested loops", () => {
    const a = newStep("log");
    const b = newStep("log");
    const loop = newStep("loop");
    const c = newStep("wait");
    let steps = insertStep([a, b, loop], loop.id, 0, c);
    steps = moveStep(steps, null, 0, 1);
    expect(steps.map((step) => step.id)).toEqual([b.id, a.id, loop.id]);
    const nested = steps[2].action;
    expect(nested.type === "loop" && nested.steps.map((step) => step.id)).toEqual([c.id]);
    steps = removeStep(steps, c.id);
    const emptied = steps[2].action;
    expect(emptied.type === "loop" && emptied.steps).toEqual([]);
  });

  test("goto to another level is an error", () => {
    const inner = newStep("log");
    const loop = newStep("loop");
    if (loop.action.type === "loop") loop.action.steps = [inner];
    const outer = { ...newStep("log"), onFailure: { type: "goto" as const, stepId: inner.id } };
    const issues = validateTask({ ...newTask("t"), steps: [outer, loop] });
    expect(
      issues.find((issue) => issue.stepId === outer.id && issue.field === "onFailure")?.message,
    ).toBe("Sprungziel liegt nicht auf derselben Ebene.");
  });
});
