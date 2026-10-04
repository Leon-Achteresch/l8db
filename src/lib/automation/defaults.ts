import type {
  Action,
  ActionType,
  CsvSettings,
  Flow,
  NotificationRule,
  OutputSpec,
  RetryPolicy,
  Schedule,
  Step,
  Task,
  Trigger,
} from "@/lib/db/automation";
import { STEP_CATALOG } from "./step-catalog";

export const DEFAULT_CSV: CsvSettings = {
  delimiter: ",",
  quote: '"',
  header: true,
  nullText: "",
  lineEnding: "\n",
  bom: false,
};

export const DEFAULT_RETRY: RetryPolicy = {
  attempts: 2,
  delaySeconds: 30,
  backoff: "exponential",
  maxDelaySeconds: null,
};

export function newId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

export function newOutput(path = ""): OutputSpec {
  return { path, appendTimestamp: true, ifExists: "rename", zip: false, cleanup: null };
}

export function newAction(type: ActionType): Action {
  switch (type) {
    case "sql":
      return { type, connections: [], database: null, sql: "", file: null };
    case "export":
      return {
        type,
        connection: "",
        database: null,
        source: { type: "query", sql: "" },
        format: "csv",
        output: newOutput("${output_dir}/export.csv"),
        csv: { ...DEFAULT_CSV },
        sheetName: null,
        maxRows: null,
      };
    case "backup":
      return {
        type,
        connection: "",
        database: null,
        output: newOutput("${output_dir}/backup-${connection|filename}"),
        options: {},
      };
    case "restore":
      return {
        type,
        connection: "",
        database: null,
        path: "",
        options: {},
        allowProduction: false,
      };
    case "transfer":
      return {
        type,
        source: "",
        sourceDatabase: null,
        target: "",
        targetDatabase: null,
        schemas: [],
        foldNames: true,
      };
    case "table_copy":
      return {
        type,
        source: "",
        sourceDatabase: null,
        target: "",
        targetDatabase: null,
        tables: [],
        mode: "truncate",
        includePrimaryKey: true,
        includeIndexes: false,
      };
    case "datagen":
      return {
        type,
        connection: "",
        database: null,
        schema: "",
        table: "",
        rows: 100,
        seed: null,
        locale: "de",
        transaction: true,
      };
    case "import":
      return {
        type,
        connection: "",
        database: null,
        schema: "",
        table: "",
        file: "",
        format: "csv",
        delimiter: null,
        hasHeader: true,
        sheet: null,
        columns: [],
        conflict: null,
      };
    case "compare":
      return {
        type,
        left: { connection: "", database: null, schema: "", table: "", filter: null },
        right: { connection: "", database: null, schema: "", table: "", filter: null },
        keyColumns: [],
        compareColumns: [],
        failIfDifferent: false,
        report: null,
      };
    case "check":
      return {
        type,
        connection: "",
        database: null,
        check: { type: "row_count", schema: null, table: null, sql: null, op: "gt", value: 0 },
        severity: "error",
      };
    case "alert":
      return {
        type,
        connection: "",
        database: null,
        sql: "",
        condition: { type: "has_rows" },
        rearmMinutes: null,
        notifyOnResolve: true,
      };
    case "shell":
      return { type, program: "", args: [], cwd: null, env: {}, successCodes: [0], capture: null };
    case "http":
      return {
        type,
        method: "post",
        url: "",
        headers: {},
        body: null,
        expectStatus: null,
        capture: null,
      };
    case "file_copy":
    case "file_move":
      return { type, from: "", to: "", overwrite: false };
    case "file_delete":
    case "mkdir":
      return { type, path: "" };
    case "file_exists":
      return { type, path: "", failIfMissing: true, capture: null };
    case "zip":
      return { type, sources: [], output: newOutput("${output_dir}/archiv.zip") };
    case "unzip":
      return { type, archive: "", target: "", overwrite: false };
    case "cleanup":
      return { type, dir: "", pattern: "*", cleanup: { olderThanDays: 30, keepLast: null } };
    case "notify":
      return { type, channel: { type: "native" }, title: "", body: "", attachOutputs: false };
    case "wait":
      return { type, seconds: 60, until: null };
    case "set_variable":
      return { type, name: "", value: "", query: null, calculate: false };
    case "condition": {
      const then: Flow = { type: "next" };
      return { type, left: "", op: "eq", right: "", then, otherwise: { type: "end_success" } };
    }
    case "loop":
      return {
        type,
        over: { type: "list", values: "" },
        steps: [],
        item: "item",
        maxIterations: null,
        continueOnError: false,
      };
    case "run_task":
      return { type, task: "", wait: true, vars: {}, environment: null };
    case "log":
      return { type, level: "info", message: "" };
    case "fail":
      return { type, message: "" };
  }
}

export function newStep(type: ActionType): Step {
  return {
    id: newId("step"),
    name: STEP_CATALOG[type].label,
    enabled: true,
    action: newAction(type),
    onSuccess: { type: "next" },
    onFailure: { type: "end_failure" },
    retry: null,
    timeoutSeconds: null,
  };
}

function tomorrowAt(time: string): string {
  const date = new Date(Date.now() + 86_400_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${time}`;
}

export function newTrigger(type: Trigger["type"]): Trigger {
  switch (type) {
    case "interval":
      return { type, every: 15, unit: "minutes" };
    case "daily":
      return { type, times: ["09:00"] };
    case "weekly":
      return { type, weekdays: [1, 2, 3, 4, 5], times: ["09:00"] };
    case "monthly":
      return { type, days: [1], lastDay: false, times: ["02:00"] };
    case "monthly_nth":
      return { type, nth: 1, weekday: 1, times: ["08:00"] };
    case "cron":
      return { type, expression: "0 9 * * 1-5" };
    case "once":
      return { type, at: tomorrowAt("09:00") };
    case "app_start":
      return { type, delaySeconds: 30 };
    case "after_task":
      return { type, taskId: "", on: "success" };
  }
}

export function newSchedule(type: Trigger["type"] = "daily"): Schedule {
  return {
    id: newId("schedule"),
    enabled: true,
    trigger: newTrigger(type),
    timezone: null,
    startAt: null,
    endAt: null,
    exclusions: [],
    window: null,
    vars: {},
    environment: null,
  };
}

export function newNotification(): NotificationRule {
  return {
    id: newId("notify"),
    enabled: true,
    when: "failure",
    channel: { type: "native" },
    title: "",
    body: "",
    attachOutputs: false,
    skipIfEmpty: false,
  };
}

export function newTask(name = "Neuer Task"): Task {
  return {
    id: newId("task"),
    name,
    description: "",
    folder: "",
    tags: [],
    enabled: false,
    steps: [],
    schedules: [],
    variables: [],
    environments: [],
    defaultEnvironment: null,
    notifications: [],
    timeoutSeconds: null,
    retry: null,
    maxConsecutiveFailures: 3,
    missedRuns: "skip",
    background: false,
    retention: null,
    needsReview: false,
    revision: 0,
    createdAt: "",
    updatedAt: "",
  };
}

export function cloneStep(step: Step): Step {
  const copy = structuredClone(step);
  const renew = (target: Step) => {
    target.id = newId("step");
    if (target.action.type === "loop") target.action.steps.forEach(renew);
  };
  renew(copy);
  copy.name = `${step.name} (Kopie)`;
  return copy;
}
