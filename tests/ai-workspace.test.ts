import { expect, test } from "bun:test";
import { approvalSummary } from "@/lib/ai/approval-presentation";
import {
  aiConnections,
  bypassAiPermissions,
  mergeAiModels,
  modelEfforts,
  modeOptions,
  safeEndpoint,
  thoughtLevel,
} from "@/lib/ai/context";
import { readAiSessions, writeAiSessions } from "@/lib/ai/session-db";
import {
  AI_PROVIDERS,
  type AiSession,
  aiSessionConnection,
  aiSessionsLoaded,
  mergeAiRecords,
  useAiStore,
} from "@/lib/ai/store";
import type { SavedConnection } from "@/lib/connections";

const connection = (id: string, extra: Partial<SavedConnection> = {}): SavedConnection => ({
  id,
  name: id,
  kind: "postgres",
  connectionString: `postgres://user@localhost/${id}`,
  sslMode: "prefer",
  ...extra,
});

test("AI context defaults to active connection and explicitly includes mentions only", () => {
  const entries = [connection("active"), connection("mentioned"), connection("unselected")];
  const result = aiConnections(entries, "active", ["mentioned", "active", "mentioned"], {
    active: "selected_db",
  });
  expect(result.map((entry) => entry.id)).toEqual(["active", "mentioned"]);
  expect(result[0].database).toBe("selected_db");
  expect(result[1].database).toBe("mentioned");
});

test("AI context fails on an unavailable SSH or proxy tunnel rather than falling back", () => {
  const ssh = connection("ssh", {
    ssh: { host: "bastion", remoteHost: "database", remotePort: 5432 } as SavedConnection["ssh"],
  });
  expect(() => aiConnections([ssh], "ssh", [], {})).toThrow("SSH-Tunnel");
  const proxy = connection("proxy", { proxy: { host: "proxy", type: "socks5", port: 1080 } });
  expect(() => aiConnections([proxy], null, ["proxy"], {})).toThrow("Proxy-Tunnel");
  expect(() => aiConnections([], null, ["deleted"], {})).toThrow("nicht mehr verfügbar");
});

test("AI context preserves schema restrictions, masking and connection read-only settings", () => {
  const entry = connection("locked", {
    readOnly: true,
    schemas: ["public"],
    environment: "production",
    maskRules: [],
  });
  const result = aiConnections([entry], entry.id, [], {});
  expect(result[0]).toMatchObject({
    readOnly: true,
    schemas: ["public"],
    environment: "production",
    maskRules: [],
  });
});

test("AI context grants production writes only to the confirmed connection", () => {
  const entries = [
    connection("prod", { environment: "production" }),
    connection("other", { environment: "production" }),
  ];
  expect(aiConnections(entries, "prod", ["other"], {}).map((e) => e.productionWrites)).toEqual([
    false,
    false,
  ]);
  expect(
    aiConnections(entries, "prod", ["other"], {}, {}, "prod").map((e) => e.productionWrites),
  ).toEqual([true, false]);
});

test("persisted provider endpoints cannot embed credentials or query tokens", () => {
  expect(safeEndpoint("https://example.com/v1")).toBe("https://example.com/v1");
  for (const url of [
    "https://user:secret@example.com/v1",
    "https://example.com/v1?api_key=secret",
    "file:///tmp/key",
    "https://example.com/#secret",
  ])
    expect(() => safeEndpoint(url)).toThrow();
});

test("multi-window AI merging retains other sessions and uses timestamped deletions", () => {
  const old = { id: "a", updatedAt: 1, title: "old" };
  const next = { id: "a", updatedAt: 3, title: "new", deleted: true };
  const other = { id: "b", updatedAt: 2, title: "other window" };
  expect(mergeAiRecords([old, other], [next])).toEqual([next, other]);
  expect(mergeAiRecords([next], [old])).toEqual([next]);
});

test("AI session stores contain safe context IDs rather than connection URLs", () => {
  const state = useAiStore.getState();
  state.saveSession({
    id: "test-safe-session",
    title: "Schema",
    profileId: "codex",
    nativeId: null,
    cwd: "/tmp/project",
    messages: [],
    connectionIds: ["active"],
    updatedAt: 1,
  });
  const session = useAiStore.getState().sessions.find((entry) => entry.id === "test-safe-session");
  expect(session).not.toHaveProperty("connections");
  expect(session).not.toHaveProperty("connectionString");
  expect(session).not.toHaveProperty("key");
});

test("native modes accept strings and advertised objects without fabricating modes", () => {
  expect(modeOptions(["auto", "AUTO", "plan"])).toEqual([{ id: "plan", name: "plan" }]);
  expect(modeOptions(["never", "none", "ask"], "approval-policy")).toEqual([
    { id: "ask", name: "ask" },
  ]);
  expect(modeOptions(["none", "ask"], "reasoning")).toHaveLength(2);
  for (const id of ["model", "reasoning", "thinking_mode", "model_mode", "reasoning_mode"])
    expect(bypassAiPermissions("auto", id)).toBe(false);
  for (const id of ["mode", "session_mode", "agent_mode", "tool_permissions", "approval-policy"])
    expect(bypassAiPermissions("auto", id)).toBe(true);
  expect(modeOptions(["auto", "high"], "reasoning")).toHaveLength(2);
  for (const value of [true, "true", "on", "enabled"])
    expect(bypassAiPermissions(value, "allow_all")).toBe(true);
  expect(bypassAiPermissions(true, "bypass_permissions")).toBe(true);
  expect(bypassAiPermissions(false, "allow_all")).toBe(false);
  expect(bypassAiPermissions("disabled", "bypass_permissions")).toBe(false);
  expect(bypassAiPermissions("never", "tool_approval_policy")).toBe(true);
  expect(bypassAiPermissions("never", "unrelated")).toBe(false);
  expect(modeOptions(["plan", { id: "code", name: "Build" }, null, {}])).toEqual([
    { id: "plan", name: "plan" },
    { id: "code", name: "Build" },
  ]);
});

test("native ACP session model metadata is normalized while preserving discovery", () => {
  const previous = { models: [{ id: "old", name: "Old" }] };
  expect(
    mergeAiModels(previous, {
      models: { availableModels: [{ modelId: "native", name: "Native" }] },
      modes: { availableModes: [{ id: "ask", name: "Ask" }] },
    }).models,
  ).toEqual([{ id: "native", name: "Native", efforts: undefined }]);
  expect(mergeAiModels(previous, { tools: ["read"] }).models).toEqual(previous.models);
  expect(modeOptions({ availableModes: [{ id: "ask", name: "Ask" }] })).toEqual([
    { id: "ask", name: "Ask" },
  ]);
});

test("reasoning choices come from Claude model levels, Copilot flags and OpenCode variants", () => {
  const base = {
    id: "p",
    name: "p",
    binary: "",
    home: "",
    endpoint: "",
    model: "",
    effort: "",
    mode: "",
  };
  const claude = {
    models: [
      { id: "default", name: "Default", efforts: ["low", "high", "max"] },
      { id: "claude-haiku-4-5", name: "Haiku 4.5" },
    ],
  };
  expect(modelEfforts({ ...base, provider: "claude" }, claude, true)).toEqual([
    "low",
    "high",
    "max",
  ]);
  expect(
    modelEfforts({ ...base, provider: "claude", model: "claude-haiku-4-5" }, claude, true),
  ).toEqual([]);
  expect(modelEfforts({ ...base, provider: "copilot" }, { models: [] }, true)).toEqual([]);
  expect(
    modelEfforts({ ...base, provider: "copilot", model: "gpt-5.4" }, { models: [] }, true),
  ).toContain("xhigh");
  const opencode = {
    models: [],
    configOptions: [
      { id: "model", category: "model", options: [{ value: "a" }] },
      {
        id: "effort",
        category: "thought_level",
        options: [{ value: "high" }, { value: "max" }, { value: "default" }],
      },
    ],
  };
  expect(thoughtLevel(opencode)).toEqual({ id: "effort", choices: ["high", "max"] });
  expect(thoughtLevel({ models: [], configOptions: [{ id: "mode", category: "mode" }] })).toBe(
    null,
  );
});

test("rapid same-millisecond profile and session updates retain newest text", () => {
  const state = useAiStore.getState();
  const profile = state.profiles[0];
  state.saveProfile({ ...profile, model: "first" });
  state.saveProfile({ ...profile, model: "second" });
  expect(useAiStore.getState().profiles[0].model).toBe("second");
  const session = {
    id: "rapid",
    title: "Rapid",
    profileId: profile.id,
    nativeId: null,
    cwd: "/tmp",
    messages: [] as { role: "assistant"; text: string }[],
    connectionIds: [],
    updatedAt: 1,
  };
  state.saveSession({ ...session, messages: [{ role: "assistant", text: "a" }] });
  state.saveSession({ ...session, messages: [{ role: "assistant", text: "ab" }] });
  expect(
    useAiStore.getState().sessions.find((entry) => entry.id === "rapid")?.messages[0].text,
  ).toBe("ab");
});

test("CLI provider identifiers exactly match the native backend contract", () => {
  expect(AI_PROVIDERS.filter((provider) => provider.cli).map((provider) => provider.id)).toEqual([
    "codex",
    "claude",
    "gemini-cli",
    "opencode",
    "copilot",
  ]);
  expect(AI_PROVIDERS.find((provider) => provider.id === "gemini-cli")?.binary).toBe("gemini");
});

test("AI cross-window persistence uses canonical entity order to prevent storage echoes", () => {
  const a = { id: "a", updatedAt: 1 };
  const b = { id: "b", updatedAt: 1 };
  expect(JSON.stringify(mergeAiRecords([a, b], [b, a]))).toBe(
    JSON.stringify(mergeAiRecords([b, a], [a, b])),
  );
});

test("approval summary exposes native arguments, changed files and permissions before confirmation", () => {
  expect(
    approvalSummary({
      title: "Run SQL",
      rawInput: { connection: "Analytics", sql: "SELECT id FROM users" },
      fileChanges: { "schema.sql": { diff: "change" } },
      permissions: { network: true, fileSystem: { write: ["/tmp/report.csv"] } },
    }),
  ).toEqual([
    { label: "Aktion", value: "Run SQL" },
    { label: "Dateien", value: "schema.sql" },
    { label: "Berechtigungen", value: "network · fileSystem.write: /tmp/report.csv" },
    { label: "Verbindung", value: "Analytics" },
    { label: "SQL", value: "SELECT id FROM users" },
  ]);
  expect(
    approvalSummary({
      requestedSchema: {},
      _meta: { params: { name: "list_tables", connectionName: "Demo" } },
    }),
  ).toContainEqual({ label: "Verbindung", value: "Demo" });
  expect(
    approvalSummary({
      connection: "Shop",
      sql: "UPDATE orders SET status = 'paid' WHERE id = 1",
      impact: "Probelauf: 1 Zeile betroffen, zurückgerollt",
    }),
  ).toEqual([
    { label: "Verbindung", value: "Shop" },
    { label: "SQL", value: "UPDATE orders SET status = 'paid' WHERE id = 1" },
    { label: "Auswirkung", value: "Probelauf: 1 Zeile betroffen, zurückgerollt" },
  ]);
  expect(
    approvalSummary({
      connection: "Shop",
      title: "Preise +10 %",
      statements: ["UPDATE products SET price = price * 1.1", "ALTER TABLE t ADD c int"],
      probes: [{ name: "Marge", sql: "SELECT 1" }],
      impact: "Wird immer zurückgerollt.",
    }),
  ).toEqual([
    { label: "Aktion", value: "Preise +10 %" },
    { label: "Verbindung", value: "Shop" },
    {
      label: "Anweisungen",
      value: "UPDATE products SET price = price * 1.1;\nALTER TABLE t ADD c int",
    },
    { label: "Messungen", value: "Marge" },
    { label: "Auswirkung", value: "Wird immer zurückgerollt." },
  ]);
  expect(
    approvalSummary({
      connection: "Shop",
      rules: [{ name: "Versand braucht Datum", sql: "SELECT 1", violations: 3 }],
    }),
  ).toContainEqual({ label: "Datenregeln", value: "Versand braucht Datum: 3 Verletzungen" });
});

const storedSession = (id: string, text: string, extra: Partial<AiSession> = {}): AiSession => ({
  id,
  title: id,
  profileId: "codex",
  nativeId: null,
  cwd: "/tmp",
  connectionIds: [],
  updatedAt: Date.now(),
  messages: [{ role: "assistant", text }],
  ...extra,
});

async function withStorage(run: (stored: Map<string, string>) => Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    },
  });
  try {
    await aiSessionsLoaded;
    await run(stored);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("AI storage quota failures preserve saved history and recover after explicit deletion", () =>
  withStorage(async () => {
    const previous = useAiStore.getState();
    const put = IDBObjectStore.prototype.put;
    let full = false;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      if (full) throw new DOMException("Quota exceeded", "QuotaExceededError");
      return put.apply(this, args);
    };
    try {
      useAiStore.getState().saveSession(storedSession("quota-history", "Keep this conversation"));
      await Bun.sleep(200);
      expect(JSON.stringify(await readAiSessions(["quota-history"]))).toContain(
        "Keep this conversation",
      );
      full = true;
      useAiStore.getState().saveSession(storedSession("quota-new", "Unsaved response"));
      await Bun.sleep(200);
      expect(await readAiSessions(["quota-new"])).toEqual([]);
      expect(useAiStore.getState().persistenceError).toContain("nicht lokal gespeichert");
      expect(
        useAiStore.getState().sessions.find((session) => session.id === "quota-new")?.messages[0]
          .text,
      ).toBe("Unsaved response");
      full = false;
      useAiStore
        .getState()
        .saveSession(storedSession("quota-new", "", { deleted: true, messages: [] }));
      await Bun.sleep(200);
      expect(useAiStore.getState().persistenceError).toBe("");
      const saved = JSON.stringify(await readAiSessions(["quota-history", "quota-new"]));
      expect(saved).toContain("Keep this conversation");
      expect(saved).toContain('"deleted":true');
      expect(saved).not.toContain("Unsaved response");
      expect(saved).not.toContain("persistenceError");
      expect(localStorage.getItem("l8db.ai")).not.toContain("quota-history");
    } finally {
      IDBObjectStore.prototype.put = put;
      useAiStore.setState(previous);
      await Bun.sleep(200);
    }
  }));

test("AI storage keeps large tool histories complete beyond the localStorage quota", () =>
  withStorage(async () => {
    const output = "row ".repeat(4_000);
    const rich = Array.from({ length: 80 }, (_, index) => ({
      type: "tool" as const,
      id: `t${index}`,
      name: "l8db_ai_search",
      status: "success",
      output,
    }));
    const messages = Array.from({ length: 20 }, (_, index) => ({
      id: `m${index}`,
      role: "assistant" as const,
      text: `answer ${index}`,
      rich,
    }));
    useAiStore.getState().saveSession(storedSession("large-tools", "", { messages }));
    await Bun.sleep(300);
    const [saved] = await readAiSessions(["large-tools"]);
    expect(JSON.stringify(saved).length).toBeGreaterThan(20_000_000);
    expect(saved.messages).toHaveLength(20);
    expect(saved.messages[19].rich?.[79]).toMatchObject({ output });
    expect(useAiStore.getState().persistenceError).toBe("");
  }));

test("AI storage migrates legacy localStorage chats into IndexedDB once", () =>
  withStorage(async () => {
    const legacy = storedSession("legacy-chat", "Legacy answer", { updatedAt: 5 });
    const profiles = [{ ...useAiStore.getState().profiles[0], model: "legacy-model" }];
    localStorage.setItem("l8db.ai", JSON.stringify({ profiles, sessions: [legacy], servers: [] }));
    const fresh = (await import("@/lib/ai/store?legacy")) as typeof import("@/lib/ai/store");
    await fresh.aiSessionsLoaded;
    expect(fresh.useAiStore.getState().sessions.map((session) => session.id)).toContain(
      "legacy-chat",
    );
    expect(JSON.stringify(await readAiSessions(["legacy-chat"]))).toContain("Legacy answer");
    const remaining = JSON.parse(localStorage.getItem("l8db.ai") ?? "{}");
    expect(remaining.sessions).toBeUndefined();
    expect(remaining.profiles[0].model).toBe("legacy-model");
  }));

test("AI storage imports chats left unsaved when a window closed", () =>
  withStorage(async () => {
    const pending = storedSession("pending-chat", "Written during pagehide", { updatedAt: 7 });
    localStorage.setItem("l8db.ai.pending", JSON.stringify({ sessions: [pending] }));
    const fresh = (await import("@/lib/ai/store?pending")) as typeof import("@/lib/ai/store");
    await fresh.aiSessionsLoaded;
    expect(JSON.stringify(await readAiSessions(["pending-chat"]))).toContain(
      "Written during pagehide",
    );
    expect(fresh.useAiStore.getState().sessions.map((session) => session.id)).toContain(
      "pending-chat",
    );
    expect(localStorage.getItem("l8db.ai.pending")).toBeNull();
  }));

test("AI storage retries a failed history load on the next save", () =>
  withStorage(async () => {
    await writeAiSessions([storedSession("retry-history", "Loaded after retry", { updatedAt: 9 })]);
    const getAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = () => {
      throw new DOMException("Read failed", "UnknownError");
    };
    let fresh: typeof import("@/lib/ai/store");
    try {
      fresh = (await import("@/lib/ai/store?retry")) as typeof import("@/lib/ai/store");
      await fresh.aiSessionsLoaded;
    } finally {
      IDBObjectStore.prototype.getAll = getAll;
    }
    expect(fresh.useAiStore.getState().persistenceError).toContain("nicht lokal gespeichert");
    expect(fresh.useAiStore.getState().sessions.some((entry) => entry.id === "retry-history")).toBe(
      false,
    );
    fresh.useAiStore.getState().saveSession(storedSession("retry-trigger", "Triggers a save"));
    await Bun.sleep(300);
    expect(fresh.useAiStore.getState().persistenceError).toBe("");
    expect(fresh.useAiStore.getState().sessions.some((entry) => entry.id === "retry-history")).toBe(
      true,
    );
  }));

test("AI storage keeps saving other chats when one chat cannot be stored", () =>
  withStorage(async () => {
    const previous = useAiStore.getState();
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      if ((args[0] as AiSession).id === "broken-chat")
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      return put.apply(this, args);
    };
    try {
      useAiStore.getState().saveSession(storedSession("broken-chat", "Too large"));
      await Bun.sleep(200);
      useAiStore.getState().saveSession(storedSession("healthy-chat", "Still saved"));
      await Bun.sleep(200);
      expect(JSON.stringify(await readAiSessions(["healthy-chat"]))).toContain("Still saved");
      expect(await readAiSessions(["broken-chat"])).toEqual([]);
      expect(useAiStore.getState().persistenceError).toContain("nicht lokal gespeichert");
    } finally {
      IDBObjectStore.prototype.put = put;
      useAiStore.setState(previous);
      await Bun.sleep(200);
    }
  }));

test("AI sessions belong to the connection they were started on", () => {
  const base = {
    id: "s",
    title: "",
    profileId: "codex",
    nativeId: null,
    cwd: "",
    messages: [],
    updatedAt: 0,
  };
  expect(aiSessionConnection({ ...base, connectionIds: ["a", "b"], connectionId: "b" })).toBe("b");
  expect(aiSessionConnection({ ...base, connectionIds: ["a"], connectionId: null })).toBeNull();
  expect(aiSessionConnection({ ...base, connectionIds: ["a", "b"] })).toBe("a");
  expect(aiSessionConnection({ ...base, connectionIds: [] })).toBeNull();
});
