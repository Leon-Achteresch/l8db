export interface AutomationSeed {
  storage: Record<string, string>;
  tasks: unknown[];
  runs: unknown[];
  alerts: unknown[];
}

export function mockAutomationInit(seed: AutomationSeed) {
  type Json = Record<string, unknown>;
  const runtime = window as unknown as Json;
  const keychain = new Map<string, string>();
  const callbacks = new Map<number, (message: unknown) => void>();
  const listeners = new Map<number, { event: string; handler: number }>();
  const calls: { cmd: string; args: Json }[] = [];
  let nextCallback = 1;
  let nextListener = 1;
  let nextRun = 1;
  const STASH = "__automation_stub";
  const stash = JSON.parse(sessionStorage.getItem(STASH) ?? "null") as {
    tasks: Json[];
    runs: Json[];
    alerts: Json[];
    settings: Json;
    keychain: [string, string][];
  } | null;
  const tasks = new Map<string, Json>();
  for (const task of (stash?.tasks ?? seed.tasks) as Json[]) tasks.set(String(task.id), task);
  for (const [account, secret] of stash?.keychain ?? []) keychain.set(account, secret);
  const states = new Map<string, Json>();
  const runs: Json[] = [...((stash?.runs ?? seed.runs) as Json[])];
  const details = new Map<string, Json>();
  const alerts: Json[] = [...((stash?.alerts ?? seed.alerts) as Json[])];
  let settings: Json = stash?.settings ?? {
    schedulerEnabled: true,
    smtpProfiles: [],
    webhooks: [],
    defaultRetention: { keepDays: 30, keepRuns: 200 },
    sshTrustNewHosts: false,
    backupToolPaths: {},
    defaultOutputDir: "~/Documents/l8db",
    notifyNativeOnFailure: true,
    maxParallelRuns: 4,
  };
  const providers = [
    {
      id: "postgres",
      name: "PostgreSQL",
      group: "postgres",
      kind: "postgres",
      default_port: 5432,
      file_based: false,
      url_schemes: ["postgresql", "postgres"],
      placeholder: "",
      hint: "",
      hosts: ["localhost"],
      driver: { type: "builtin" },
      capabilities: {
        ssl: true,
        ssh: true,
        views: true,
        read_only_mode: true,
        backup: true,
        csv_import: true,
        table_copy: true,
        data_compare: true,
        full_table_export: true,
        query_language: "sql",
      },
      driver_status: { available: true, detail: "", install: [] },
    },
  ];

  const now = () => new Date().toISOString();
  const inHours = (hours: number) => new Date(Date.now() + hours * 3600000).toISOString();

  function stateOf(task: Json): Json {
    const id = String(task.id);
    const existing = states.get(id);
    if (existing) return existing;
    const scheduled = Array.isArray(task.schedules) && task.schedules.length > 0;
    const state = {
      taskId: id,
      nextRunAt: task.enabled && scheduled ? inHours(2 + states.size * 3) : null,
      lastRunAt: null,
      lastRunId: null,
      lastStatus: null,
      consecutiveFailures: 0,
      disabledReason: null,
    };
    states.set(id, state);
    return state;
  }

  function summary(task: Json): Json {
    const id = String(task.id);
    const taskRuns = runs.filter((run) => run.taskId === id && run.status !== "running");
    const ok = taskRuns.filter((run) => run.status === "success").length;
    const running = runs.find((run) => run.taskId === id && run.status === "running");
    return {
      task,
      state: stateOf(task),
      runningRunId: running ? running.id : null,
      stats: {
        runs: taskRuns.length,
        successRate: taskRuns.length ? ok / taskRuns.length : null,
        averageMs: taskRuns.length ? 4200 : null,
      },
      alerts: alerts.filter((alert) => alert.taskId === id),
    };
  }

  function emit(payload: unknown) {
    for (const [id, listener] of listeners) {
      if (listener.event !== "automation-event") continue;
      callbacks.get(listener.handler)?.({ event: "automation-event", id, payload });
    }
  }

  function stepRun(
    runId: string,
    seq: number,
    step: Json,
    status: string,
    durationMs: number | null,
  ) {
    const detail = details.get(runId) as Json;
    const started = new Date(
      new Date(String((detail.summary as Json).startedAt)).getTime() +
        (seq - 1) * (durationMs ?? 0),
    );
    return {
      seq,
      stepId: String(step.id),
      stepName: String(step.name),
      kind: String((step.action as Json).type),
      depth: 0,
      iteration: null,
      attempt: 1,
      status,
      startedAt: started.toISOString(),
      finishedAt:
        durationMs == null ? null : new Date(started.getTime() + durationMs).toISOString(),
      durationMs,
      rows: status === "success" ? 1284 : null,
      rowsAffected: null,
      message: status === "success" ? "1.284 Zeilen exportiert" : null,
      error: null,
    };
  }

  function startRun(input: Json): string {
    const task = tasks.get(String(input.taskId)) as Json;
    const id = `run-live-${nextRun++}`;
    const steps = (task.steps as Json[]) ?? [];
    const run = {
      id,
      taskId: task.id,
      taskName: task.name,
      trigger: input.rerunOf ? "rerun" : "manual",
      triggerDetail: null,
      status: "running",
      startedAt: now(),
      finishedAt: null,
      durationMs: null,
      error: null,
      environment: input.environment ?? null,
      rerunOf: input.rerunOf ?? null,
      parentRunId: null,
      stepsTotal: steps.length,
      stepsDone: 0,
      outputs: 0,
    };
    runs.unshift(run);
    details.set(id, {
      summary: run,
      steps: [],
      logs: [],
      outputs: [],
      vars: { date: "2026-10-04" },
      definition: task,
    });
    setTimeout(() => {
      emit({ event: "run_started", run });
      const first = steps[0];
      if (!first) return;
      const step = stepRun(id, 1, first, "running", null);
      (details.get(id) as Json).steps = [step];
      emit({ event: "run_step", runId: id, taskId: task.id, step });
      emit({
        event: "run_log",
        runId: id,
        line: {
          seq: 1,
          at: now(),
          level: "info",
          stepId: first.id,
          message: `Starte „${first.name}“`,
        },
      });
    }, 30);
    return id;
  }

  function finishRun(id: string, status = "success") {
    const detail = details.get(id) as Json;
    if (!detail) return;
    const task = detail.definition as Json;
    const taskSteps = (task.steps as Json[]) ?? [];
    const elapsed = Date.now() - new Date(String((detail.summary as Json).startedAt)).getTime();
    const each = Math.max(Math.floor(elapsed / Math.max(taskSteps.length, 1)) - 5, 1);
    const steps = taskSteps.map((step, index) =>
      stepRun(id, index + 1, step, status === "success" || index === 0 ? "success" : status, each),
    );
    for (const step of steps) emit({ event: "run_step", runId: id, taskId: task.id, step });
    emit({
      event: "run_log",
      runId: id,
      line: {
        seq: 2,
        at: now(),
        level: "info",
        stepId: steps[0]?.stepId ?? null,
        message: "1.284 Zeilen exportiert",
      },
    });
    const summaryRun = detail.summary as Json;
    const durationMs = Date.now() - new Date(String(summaryRun.startedAt)).getTime();
    const run = {
      ...summaryRun,
      status,
      finishedAt: now(),
      durationMs,
      stepsDone: steps.length,
      outputs: status === "success" ? 1 : 0,
      error: status === "success" ? null : "Verbindung zum Server verloren.",
    };
    const index = runs.findIndex((entry) => entry.id === id);
    runs[index] = run;
    details.set(id, {
      ...detail,
      summary: run,
      steps,
      logs: [
        {
          seq: 1,
          at: run.startedAt,
          level: "info",
          stepId: steps[0]?.stepId ?? null,
          message: "Starte Export",
        },
        {
          seq: 2,
          at: now(),
          level: "info",
          stepId: steps[0]?.stepId ?? null,
          message: "1.284 Zeilen exportiert",
        },
      ],
      outputs:
        status === "success"
          ? [
              {
                stepId: steps[0]?.stepId ?? "",
                path: "~/Documents/l8db/berichte/umsatz-2026-10-03.csv",
                bytes: 48213,
                format: "csv",
              },
            ]
          : [],
    });
    const state = stateOf(task);
    Object.assign(state, { lastRunAt: run.startedAt, lastRunId: id, lastStatus: status });
    emit({ event: "run_finished", run });
  }

  function filterRuns(filter: Json): Json[] {
    const statuses = (filter.statuses as string[] | undefined) ?? [];
    const triggers = (filter.triggers as string[] | undefined) ?? [];
    const text = String(filter.text ?? "").toLowerCase();
    return runs
      .filter((run) => !filter.taskId || run.taskId === filter.taskId)
      .filter((run) => statuses.length === 0 || statuses.includes(String(run.status)))
      .filter((run) => triggers.length === 0 || triggers.includes(String(run.trigger)))
      .filter((run) => !text || `${run.taskName} ${run.error ?? ""}`.toLowerCase().includes(text))
      .slice(0, Number(filter.limit ?? 200));
  }

  function detailFor(id: string): Json {
    const existing = details.get(id);
    if (existing) return existing;
    const run = runs.find((entry) => entry.id === id) as Json;
    const task = (tasks.get(String(run.taskId)) ?? { steps: [] }) as Json;
    const start = new Date(String(run.startedAt)).getTime();
    const steps = ((task.steps as Json[]) ?? []).map((step, index) => {
      const failed = run.status === "failed" && index === (task.steps as Json[]).length - 1;
      const begin = start + index * 2100;
      return {
        seq: index + 1,
        stepId: step.id,
        stepName: step.name,
        kind: (step.action as Json).type,
        depth: 0,
        iteration: null,
        attempt: 1,
        status: failed ? "failed" : "success",
        startedAt: new Date(begin).toISOString(),
        finishedAt: new Date(begin + 1900).toISOString(),
        durationMs: 1900,
        rows: failed ? null : 412,
        rowsAffected: null,
        message: null,
        error: failed ? run.error : null,
      };
    });
    return {
      summary: run,
      steps,
      logs: steps.map((step, index) => ({
        seq: index + 1,
        at: step.startedAt,
        level: step.status === "failed" ? "error" : "info",
        stepId: step.stepId,
        message: step.status === "failed" ? String(step.error) : `${step.stepName} abgeschlossen`,
      })),
      outputs: [],
      vars: { date: "2026-10-04" },
      definition: task,
    };
  }

  runtime.__automationCalls = calls;
  runtime.__automationEmit = emit;
  runtime.__automationFinish = finishRun;
  runtime.__automationKeychain = keychain;
  runtime.__automationAdd = (extra: { tasks?: Json[]; runs?: Json[]; alerts?: Json[] }) => {
    for (const task of extra.tasks ?? []) tasks.set(String(task.id), task);
    runs.push(...(extra.runs ?? []));
    alerts.push(...(extra.alerts ?? []));
    emit({ event: "tasks_changed", ids: (extra.tasks ?? []).map((task) => task.id) });
  };

  runtime.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main", windowLabel: "main" },
    },
    transformCallback: (callback: (message: unknown) => void) => {
      const id = nextCallback++;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback: (id: number) => callbacks.delete(id),
    convertFileSrc: (path: string) => path,
    plugins: {},
    invoke: async (cmd: string, args?: unknown) => {
      const input = (args ?? {}) as Json;
      calls.push({ cmd, args: input });
      queueMicrotask(() =>
        sessionStorage.setItem(
          STASH,
          JSON.stringify({
            tasks: [...tasks.values()],
            runs,
            alerts,
            settings,
            keychain: [...keychain],
          }),
        ),
      );
      switch (cmd) {
        case "plugin:event|listen": {
          const id = nextListener++;
          listeners.set(id, { event: String(input.event), handler: Number(input.handler) });
          return id;
        }
        case "plugin:event|unlisten":
          listeners.delete(Number(input.eventId));
          return null;
        case "list_providers":
          return providers;
        case "list_databases":
          return ["shop"];
        case "list_schemas":
          return ["public"];
        case "list_tables":
          return [{ schema: "public", name: "orders" }];
        case "store_secret":
          keychain.set(String(input.account), String(input.secret));
          return null;
        case "load_secret":
          return keychain.get(String(input.account)) ?? null;
        case "delete_secret":
          keychain.delete(String(input.account));
          return null;
        case "automation_sync_connections":
          return null;
        case "automation_list_tasks":
          return [...tasks.values()].map(summary);
        case "automation_get_task":
          return tasks.get(String(input.id)) ?? null;
        case "automation_save_task": {
          const task = { ...(input.task as Json) };
          task.revision = Number(task.revision ?? 0) + 1;
          task.needsReview = false;
          task.updatedAt = now();
          tasks.set(String(task.id), task);
          states.delete(String(task.id));
          return summary(task);
        }
        case "automation_delete_tasks":
          for (const id of input.ids as string[]) tasks.delete(id);
          return null;
        case "automation_duplicate_task": {
          const source = tasks.get(String(input.id)) as Json;
          const copy = {
            ...source,
            id: `${source.id}-copy`,
            name: `${source.name} (Kopie)`,
            revision: 0,
          };
          tasks.set(String(copy.id), copy);
          return summary(copy);
        }
        case "automation_set_enabled":
          return (input.ids as string[]).map((id) => {
            const task = { ...(tasks.get(id) as Json), enabled: Boolean(input.enabled) };
            tasks.set(id, task);
            states.delete(id);
            return summary(task);
          });
        case "automation_validate_task":
          return [];
        case "automation_export_tasks":
          return (input.ids as string[]).length;
        case "automation_import_tasks":
          return { imported: [], renamed: [], needsReview: [] };
        case "automation_run_task":
          return startRun(input.input as Json);
        case "automation_cancel_run":
          finishRun(String(input.runId), "cancelled");
          return true;
        case "automation_list_runs":
          return filterRuns((input.filter ?? {}) as Json);
        case "automation_get_run":
          return detailFor(String(input.runId));
        case "automation_delete_runs":
          return 0;
        case "automation_export_runs":
          return 0;
        case "automation_preview_schedule": {
          const count = Number(input.count ?? 5);
          return Array.from({ length: count }, (_, index) => inHours(14 + index * 24));
        }
        case "automation_next_runs":
          return [...tasks.values()]
            .filter((task) => task.enabled && (task.schedules as unknown[]).length > 0)
            .flatMap((task, index) => {
              const every = String(task.id).includes("alarm") ? 2 : 24;
              return Array.from({ length: Math.ceil(24 / every) }, (_, step) => ({
                taskId: task.id,
                at: inHours(1 + index * 3 + step * every),
              }));
            })
            .filter((entry) => new Date(entry.at).getTime() < Date.now() + 24 * 3600000);
        case "automation_get_settings":
          return settings;
        case "automation_save_settings":
          settings = input.settings as Json;
          return settings;
        case "automation_test_channel":
          return null;
        case "automation_test_connection":
          return { ok: true, via: "direkt", message: "Verbunden" };
        case "automation_set_alert_mute": {
          const alert = alerts.find(
            (entry) => entry.taskId === input.taskId && entry.stepId === input.stepId,
          ) as Json;
          alert.mutedUntil = input.until ?? null;
          return { ...alert };
        }
        case "automation_background_status":
          return {
            supported: true,
            installed: false,
            mechanism: "launchd",
            location: null,
            binary: "/Applications/l8db.app/Contents/MacOS/l8db",
            lastTickAt: null,
            detail: null,
          };
        case "automation_cli_command":
          return `l8db --run-task ${input.taskId}`;
        default:
          return null;
      }
    },
  };
  runtime.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  if (stash) return;
  localStorage.clear();
  for (const [key, value] of Object.entries(seed.storage)) localStorage.setItem(key, value);
}

export const CONNECTION = {
  id: "pg-shop",
  name: "Shop (Staging)",
  kind: "postgres",
  connectionString: "postgres://app@localhost:5432/shop",
  sslMode: "prefer",
  environment: "staging",
};

const iso = (offsetHours: number) => new Date(Date.now() + offsetHours * 3600000).toISOString();

function schedule(trigger: Record<string, unknown>) {
  return {
    id: `sched-${Math.random().toString(36).slice(2, 8)}`,
    enabled: true,
    trigger,
    timezone: null,
    startAt: null,
    endAt: null,
    exclusions: [],
    window: null,
    vars: {},
    environment: null,
  };
}

function task(id: string, name: string, folder: string, extra: Record<string, unknown>) {
  return {
    id,
    name,
    description: "",
    folder,
    tags: [],
    enabled: true,
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
    createdAt: iso(-72),
    updatedAt: iso(-72),
    ...extra,
  };
}

function step(id: string, name: string, action: Record<string, unknown>) {
  return {
    id,
    name,
    enabled: true,
    action,
    onSuccess: { type: "next" },
    onFailure: { type: "end_failure" },
    retry: null,
    timeoutSeconds: null,
  };
}

export const CSV_REPORT = task("task-csv", "Täglicher CSV-Bericht", "Berichte", {
  tags: ["bericht"],
  description: "Exportiert die Umsätze von gestern als CSV und verschickt sie per E-Mail.",
  steps: [
    step("step-export", "Umsätze exportieren", {
      type: "export",
      connection: CONNECTION.id,
      database: "shop",
      source: { type: "query", sql: "SELECT * FROM orders" },
      format: "csv",
      output: {
        path: "~/Documents/l8db/berichte/umsatz.csv",
        appendTimestamp: false,
        ifExists: "overwrite",
        zip: false,
        cleanup: null,
      },
    }),
  ],
  schedules: [schedule({ type: "weekly", weekdays: [1, 2, 3, 4, 5], times: ["07:00"] })],
});

export const ALERT_TASK = task("task-alarm", "Hängende Bestellungen", "Überwachung", {
  tags: ["alarm"],
  steps: [
    step("step-alert", "Bestellungen älter als 1 h", {
      type: "alert",
      connection: CONNECTION.id,
      database: "shop",
      sql: "SELECT id FROM orders WHERE status = 'pending'",
      condition: { type: "has_rows" },
      rearmMinutes: 240,
      notifyOnResolve: true,
    }),
    step("step-alert-2", "Replikationsverzug", {
      type: "alert",
      connection: CONNECTION.id,
      database: "shop",
      sql: "SELECT lag_seconds FROM replication_status",
      condition: { type: "value", column: "lag_seconds", op: "gt", threshold: "30" },
      rearmMinutes: 60,
      notifyOnResolve: true,
    }),
  ],
  schedules: [schedule({ type: "interval", every: 15, unit: "minutes" })],
});

export const BACKUP_TASK = task("task-backup", "Nächtliches Backup", "Wartung/Backups", {
  steps: [
    step("step-backup", "Datenbank sichern", {
      type: "backup",
      connection: CONNECTION.id,
      database: null,
      output: {
        path: "~/Backups/shop",
        appendTimestamp: true,
        ifExists: "rename",
        zip: false,
        cleanup: null,
      },
      options: {},
    }),
    step("step-cleanup", "Alte Sicherungen löschen", {
      type: "cleanup",
      dir: "~/Backups",
      pattern: "*.dump",
      cleanup: { olderThanDays: 14, keepLast: 7 },
    }),
    step("step-notify", "Bericht senden", {
      type: "notify",
      channel: { type: "native" },
      title: "",
      body: "",
      attachOutputs: false,
    }),
  ],
  schedules: [schedule({ type: "daily", times: ["02:00"] })],
});

function pastRun(
  id: string,
  source: { id: string; name: string; steps: unknown[] },
  status: string,
  hoursAgo: number,
  trigger = "schedule",
) {
  return {
    id,
    taskId: source.id,
    taskName: source.name,
    trigger,
    triggerDetail: null,
    status,
    startedAt: iso(-hoursAgo),
    finishedAt: iso(-hoursAgo + 0.002),
    durationMs: 6300,
    error: status === "failed" ? "pg_dump: Verbindung zum Server verloren." : null,
    environment: null,
    rerunOf: null,
    parentRunId: null,
    stepsTotal: source.steps.length,
    stepsDone: source.steps.length,
    outputs: status === "success" ? 1 : 0,
  };
}

export const EXTRA = {
  tasks: [ALERT_TASK, BACKUP_TASK],
  runs: [
    pastRun("run-backup-1", BACKUP_TASK, "failed", 5),
    pastRun("run-backup-2", BACKUP_TASK, "success", 29),
    pastRun("run-alarm-1", ALERT_TASK, "success", 0.3),
  ],
  alerts: [
    {
      taskId: ALERT_TASK.id,
      stepId: "step-alert",
      status: "triggered",
      since: iso(-1.5),
      checkedAt: iso(-0.2),
      lastNotifiedAt: iso(-1.5),
      lastValue: "7 Zeilen",
      mutedUntil: null,
    },
    {
      taskId: ALERT_TASK.id,
      stepId: "step-alert-2",
      status: "ok",
      since: iso(-30),
      checkedAt: iso(-0.2),
      lastNotifiedAt: null,
      lastValue: "2",
      mutedUntil: null,
    },
  ],
};

export function automationStorage(theme: "light" | "dark"): Record<string, string> {
  return {
    theme,
    "l8db.settings": JSON.stringify({ state: { onboardingDone: true }, version: 0 }),
    "l8db.tour": JSON.stringify({ state: { offerDismissed: true }, version: 0 }),
    "l8db.connections": JSON.stringify({
      state: { connections: [CONNECTION], activeId: null, recentIds: [] },
      version: 0,
    }),
  };
}
