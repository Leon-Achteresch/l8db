import { beforeEach, describe, expect, mock, test } from "bun:test";

const invokes: { command: string; args: Record<string, unknown> }[] = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown>) => {
    invokes.push({ command, args });
    if (command === "automation_run_task") return "run-manual";
    return null;
  },
  transformCallback: () => 1,
}));

mock.module("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
}));

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "window", {
  value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    addEventListener: () => {},
  },
  configurable: true,
});
Object.defineProperty(globalThis, "localStorage", {
  value: window.localStorage,
  configurable: true,
});

const { newTask } = await import("../src/lib/automation/defaults");
const { needsRunPrompt, useAutomationStore } = await import("../src/lib/automation/store");
const { automationTaskId, bridgeAutomationEvent } = await import(
  "../src/lib/automation/task-bridge"
);
const { cancelTask, useTasksStore } = await import("../src/lib/tasks");

type RunSummary = import("../src/lib/db/automation").RunSummary;
type StepRun = import("../src/lib/db/automation").StepRun;
type TaskSummary = import("../src/lib/db/automation").TaskSummary;
type AlertState = import("../src/lib/db/automation").AlertState;

function summary(id = "task-1"): TaskSummary {
  const task = { ...newTask("Nächtliches Backup"), id };
  return {
    task,
    state: {
      taskId: id,
      nextRunAt: null,
      lastRunAt: null,
      lastRunId: null,
      lastStatus: null,
      consecutiveFailures: 0,
      disabledReason: null,
    },
    runningRunId: null,
    stats: { runs: 0, successRate: null, averageMs: null },
    alerts: [],
  };
}

function run(patch: Partial<RunSummary> = {}): RunSummary {
  return {
    id: "run-1",
    taskId: "task-1",
    taskName: "Nächtliches Backup",
    trigger: "manual",
    triggerDetail: null,
    status: "running",
    startedAt: "2026-10-04T08:00:00Z",
    finishedAt: null,
    durationMs: null,
    error: null,
    environment: null,
    rerunOf: null,
    parentRunId: null,
    stepsTotal: 3,
    stepsDone: 0,
    outputs: 0,
    ...patch,
  };
}

function step(seq: number, stepId: string, patch: Partial<StepRun> = {}): StepRun {
  return {
    seq,
    stepId,
    stepName: `Schritt ${stepId}`,
    kind: "sql",
    depth: 0,
    iteration: null,
    attempt: 1,
    status: "success",
    startedAt: "2026-10-04T08:00:00Z",
    finishedAt: "2026-10-04T08:00:01Z",
    durationMs: 1000,
    rows: null,
    rowsAffected: null,
    message: null,
    error: null,
    ...patch,
  };
}

function alert(status: AlertState["status"], stepId = "alert-1"): AlertState {
  return {
    taskId: "task-1",
    stepId,
    status,
    since: "2026-10-04T08:00:00Z",
    checkedAt: "2026-10-04T08:00:00Z",
    lastNotifiedAt: null,
    lastValue: "42",
    mutedUntil: null,
  };
}

const store = () => useAutomationStore.getState();

beforeEach(() => {
  invokes.length = 0;
  useAutomationStore.setState({
    tasks: [summary()],
    runs: [],
    activeRuns: {},
    runPrompt: null,
    selection: [],
    selectedId: null,
  });
  useTasksStore.setState({ tasks: [] });
});

describe("applyEvent", () => {
  test("run_started legt einen aktiven Lauf an und markiert den Task", () => {
    store().applyEvent({ event: "run_started", run: run() });
    expect(Object.keys(store().activeRuns)).toEqual(["run-1"]);
    expect(store().runs.map((entry) => entry.id)).toEqual(["run-1"]);
    expect(store().tasks[0].runningRunId).toBe("run-1");
  });

  test("run_step zählt nur abgeschlossene Schritte der obersten Ebene", () => {
    store().applyEvent({ event: "run_started", run: run() });
    store().applyEvent({
      event: "run_step",
      runId: "run-1",
      step: step(1, "a", { status: "running" }),
    });
    expect(store().activeRuns["run-1"].summary.stepsDone).toBe(0);
    store().applyEvent({ event: "run_step", runId: "run-1", step: step(1, "a") });
    store().applyEvent({
      event: "run_step",
      runId: "run-1",
      step: step(2, "loop-child", { depth: 1 }),
    });
    store().applyEvent({
      event: "run_step",
      runId: "run-1",
      step: step(3, "b", { status: "failed", attempt: 1 }),
    });
    store().applyEvent({ event: "run_step", runId: "run-1", step: step(4, "b", { attempt: 2 }) });
    const active = store().activeRuns["run-1"];
    expect(active.steps.map((entry) => entry.seq)).toEqual([1, 2, 3, 4]);
    expect(active.summary.stepsDone).toBe(2);
    expect(store().runs[0].stepsDone).toBe(2);
  });

  test("run_step und run_log für unbekannte Läufe werden ignoriert", () => {
    store().applyEvent({ event: "run_step", runId: "nope", step: step(1, "a") });
    store().applyEvent({
      event: "run_log",
      runId: "nope",
      line: { seq: 1, at: "2026-10-04T08:00:00Z", level: "info", stepId: null, message: "x" },
    });
    expect(store().activeRuns).toEqual({});
  });

  test("run_log hängt Zeilen an", () => {
    store().applyEvent({ event: "run_started", run: run() });
    for (let seq = 1; seq <= 3; seq++)
      store().applyEvent({
        event: "run_log",
        runId: "run-1",
        line: {
          seq,
          at: "2026-10-04T08:00:00Z",
          level: "info",
          stepId: "a",
          message: `Zeile ${seq}`,
        },
      });
    expect(store().activeRuns["run-1"].logs.map((line) => line.message)).toEqual([
      "Zeile 1",
      "Zeile 2",
      "Zeile 3",
    ]);
  });

  test("run_finished entfernt den aktiven Lauf und schreibt den Task-Zustand", () => {
    store().applyEvent({ event: "run_started", run: run() });
    store().applyEvent({
      event: "run_finished",
      run: run({ status: "failed", finishedAt: "2026-10-04T08:00:05Z", error: "Timeout" }),
    });
    expect(store().activeRuns).toEqual({});
    expect(store().runs[0].status).toBe("failed");
    const task = store().tasks[0];
    expect(task.runningRunId).toBeNull();
    expect(task.state.lastStatus).toBe("failed");
    expect(task.state.lastRunId).toBe("run-1");
    expect(task.state.lastRunAt).toBe("2026-10-04T08:00:00Z");
  });

  test("alert_changed ersetzt oder ergänzt den Alarmzustand", () => {
    store().applyEvent({ event: "alert_changed", alert: alert("ok") });
    expect(store().tasks[0].alerts.map((entry) => entry.status)).toEqual(["ok"]);
    store().applyEvent({ event: "alert_changed", alert: alert("triggered") });
    expect(store().tasks[0].alerts.map((entry) => entry.status)).toEqual(["triggered"]);
    store().applyEvent({ event: "alert_changed", alert: alert("error", "alert-2") });
    expect(store().tasks[0].alerts).toHaveLength(2);
  });

  test("tasks_changed verändert den Zustand nicht", () => {
    const before = store().tasks;
    store().applyEvent({ event: "tasks_changed" });
    expect(store().tasks).toBe(before);
  });
});

describe("requestRun", () => {
  test("startet ohne Abfrage direkt", async () => {
    const id = await store().requestRun(store().tasks[0]);
    expect(id).toBe("run-manual");
    expect(invokes.find((entry) => entry.command === "automation_run_task")).toBeTruthy();
    expect(store().tasks[0].runningRunId).toBe("run-manual");
  });

  test("öffnet die Abfrage bei abgefragten Variablen", async () => {
    const prompted = summary();
    prompted.task.variables = [
      {
        name: "stichtag",
        kind: "date",
        defaultValue: "",
        choices: [],
        prompt: true,
        description: "",
      },
    ];
    expect(needsRunPrompt(prompted.task)).toBe(true);
    const id = await store().requestRun(prompted);
    expect(id).toBeNull();
    expect(store().runPrompt?.task.id).toBe("task-1");
    expect(invokes.some((entry) => entry.command === "automation_run_task")).toBe(false);
  });
});

describe("Task-Center-Brücke", () => {
  const tasks = () => useTasksStore.getState().tasks;

  test("Start, Fortschritt und Erfolg", () => {
    bridgeAutomationEvent({ event: "run_started", run: run() });
    expect(tasks()[0]).toMatchObject({
      id: automationTaskId("run-1"),
      title: "Automatisierung · Nächtliches Backup",
      total: 3,
      status: "running",
      cancellable: true,
    });
    expect(automationTaskId("run-1")).toBe("automation:run-1");
    bridgeAutomationEvent({
      event: "run_step",
      runId: "run-1",
      step: step(1, "a", { status: "running" }),
    });
    expect(tasks()[0].detail).toBe("Schritt 1: Schritt a");
    expect(tasks()[0].progress).toBeUndefined();
    bridgeAutomationEvent({ event: "run_step", runId: "run-1", step: step(1, "a") });
    bridgeAutomationEvent({ event: "run_step", runId: "run-1", step: step(2, "b") });
    expect(tasks()[0].progress).toBe(2);
    bridgeAutomationEvent({ event: "run_finished", run: run({ status: "success", stepsDone: 3 }) });
    expect(tasks()[0]).toMatchObject({
      status: "success",
      progress: 3,
      total: 3,
      cancellable: false,
    });
  });

  test("doppeltes run_started erzeugt keinen zweiten Eintrag", () => {
    bridgeAutomationEvent({ event: "run_started", run: run() });
    bridgeAutomationEvent({ event: "run_started", run: run() });
    expect(tasks()).toHaveLength(1);
  });

  test("Abbrechen im Task-Center ruft automation_cancel_run", async () => {
    bridgeAutomationEvent({ event: "run_started", run: run() });
    await cancelTask(automationTaskId("run-1"));
    expect(invokes.find((entry) => entry.command === "automation_cancel_run")?.args).toEqual({
      runId: "run-1",
    });
  });

  test("abgebrochener Lauf endet als abgebrochen", () => {
    bridgeAutomationEvent({ event: "run_started", run: run() });
    bridgeAutomationEvent({ event: "run_finished", run: run({ status: "cancelled" }) });
    expect(tasks()[0].status).toBe("cancelled");
  });

  test("fehlgeschlagener Lauf endet mit Fehlermeldung", () => {
    for (const status of ["failed", "timeout", "interrupted"] as const) {
      useTasksStore.setState({ tasks: [] });
      bridgeAutomationEvent({ event: "run_started", run: run() });
      bridgeAutomationEvent({
        event: "run_finished",
        run: run({ status, error: "Verbindung verloren" }),
      });
      expect(tasks()[0]).toMatchObject({ status: "error", error: "Verbindung verloren" });
    }
  });

  test("Ende ohne laufenden Eintrag wird ignoriert", () => {
    bridgeAutomationEvent({ event: "run_finished", run: run({ status: "success" }) });
    expect(tasks()).toHaveLength(0);
  });
});
