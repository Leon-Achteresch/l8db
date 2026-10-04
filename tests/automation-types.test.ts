import { describe, expect, test } from "bun:test";
import type {
  Action,
  AlertCondition,
  ChannelRef,
  CheckSpec,
  ExportSource,
  Flow,
  LoopSource,
  Step,
  Task,
  Trigger,
} from "../src/lib/db/automation";
import fixture from "../src-tauri/src/automation/fixtures/task-v1.json";

const task: Task = fixture as Task;

const ACTION_TYPES = {
  sql: true,
  export: true,
  backup: true,
  restore: true,
  transfer: true,
  table_copy: true,
  datagen: true,
  import: true,
  compare: true,
  check: true,
  alert: true,
  shell: true,
  http: true,
  file_copy: true,
  file_move: true,
  file_delete: true,
  mkdir: true,
  file_exists: true,
  zip: true,
  unzip: true,
  cleanup: true,
  notify: true,
  wait: true,
  set_variable: true,
  condition: true,
  loop: true,
  run_task: true,
  log: true,
  fail: true,
} satisfies Record<Action["type"], true>;

const TRIGGER_TYPES = {
  interval: true,
  daily: true,
  weekly: true,
  monthly: true,
  monthly_nth: true,
  cron: true,
  once: true,
  app_start: true,
  after_task: true,
} satisfies Record<Trigger["type"], true>;

const CHECK_TYPES = {
  row_count: true,
  value: true,
  not_null: true,
  unique: true,
  accepted_values: true,
  freshness: true,
  query: true,
} satisfies Record<CheckSpec["type"], true>;

const CHANNEL_TYPES = { native: true, email: true, webhook: true } satisfies Record<
  ChannelRef["type"],
  true
>;

const FLOW_TYPES = {
  next: true,
  goto: true,
  end_success: true,
  end_failure: true,
} satisfies Record<Flow["type"], true>;

const ALERT_TYPES = { has_rows: true, no_rows: true, value: true, error: true } satisfies Record<
  AlertCondition["type"],
  true
>;

const LOOP_TYPES = { query: true, connections: true, list: true, files: true } satisfies Record<
  LoopSource["type"],
  true
>;

const EXPORT_SOURCE_TYPES = { query: true, table: true } satisfies Record<
  ExportSource["type"],
  true
>;

function allSteps(steps: Step[]): Step[] {
  return steps.flatMap((step) =>
    step.action.type === "loop" ? [step, ...allSteps(step.action.steps)] : [step],
  );
}

function seen() {
  const found = {
    action: new Set<string>(),
    trigger: new Set<string>(),
    check: new Set<string>(),
    channel: new Set<string>(),
    flow: new Set<string>(),
    alert: new Set<string>(),
    loop: new Set<string>(),
    exportSource: new Set<string>(),
  };
  for (const schedule of task.schedules) found.trigger.add(schedule.trigger.type);
  for (const rule of task.notifications) found.channel.add(rule.channel.type);
  for (const step of allSteps(task.steps)) {
    const { action } = step;
    found.action.add(action.type);
    found.flow.add(step.onSuccess.type);
    found.flow.add(step.onFailure.type);
    if (action.type === "check") found.check.add(action.check.type);
    if (action.type === "notify") found.channel.add(action.channel.type);
    if (action.type === "alert") found.alert.add(action.condition.type);
    if (action.type === "loop") found.loop.add(action.over.type);
    if (action.type === "export") found.exportSource.add(action.source.type);
    if (action.type === "condition") {
      found.flow.add(action.then.type);
      found.flow.add(action.otherwise.type);
    }
  }
  return found;
}

describe("automation types", () => {
  const found = seen();

  test.each([
    ["action", ACTION_TYPES, found.action],
    ["trigger", TRIGGER_TYPES, found.trigger],
    ["check", CHECK_TYPES, found.check],
    ["channel", CHANNEL_TYPES, found.channel],
    ["flow", FLOW_TYPES, found.flow],
    ["alert", ALERT_TYPES, found.alert],
    ["loop", LOOP_TYPES, found.loop],
    ["exportSource", EXPORT_SOURCE_TYPES, found.exportSource],
  ] as const)("fixture covers every %s type", (_name, expected, actual) => {
    expect([...actual].sort()).toEqual(Object.keys(expected).sort());
  });

  test("every step carries all fields of the TS shape", () => {
    const keys = [
      "id",
      "name",
      "enabled",
      "action",
      "onSuccess",
      "onFailure",
      "retry",
      "timeoutSeconds",
    ];
    for (const step of allSteps(task.steps)) expect(Object.keys(step).sort()).toEqual(keys.sort());
  });

  test("task carries every top-level field", () => {
    const keys: (keyof Task)[] = [
      "id",
      "name",
      "description",
      "folder",
      "tags",
      "enabled",
      "steps",
      "schedules",
      "variables",
      "environments",
      "defaultEnvironment",
      "notifications",
      "timeoutSeconds",
      "retry",
      "maxConsecutiveFailures",
      "missedRuns",
      "background",
      "retention",
      "needsReview",
      "revision",
      "createdAt",
      "updatedAt",
    ];
    expect(Object.keys(task).sort()).toEqual([...keys].sort());
  });
});
