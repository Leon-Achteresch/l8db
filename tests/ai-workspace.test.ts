import { expect, test } from "bun:test";
import { approvalSummary } from "@/lib/ai/approval-presentation";
import {
  aiConnections,
  bypassAiPermissions,
  mergeAiModels,
  modeOptions,
  safeEndpoint,
} from "@/lib/ai/context";
import { AI_PROVIDERS, mergeAiRecords, useAiStore } from "@/lib/ai/store";
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
});

test("AI storage quota failures preserve saved history and recover after explicit deletion", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previous = useAiStore.getState();
  const stored = new Map<string, string>();
  let full = false;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (full) throw new DOMException("Quota exceeded", "QuotaExceededError");
        stored.set(key, value);
      },
    },
  });
  const saved = {
    id: "quota-history",
    title: "Saved history",
    profileId: "codex",
    nativeId: null,
    cwd: "/tmp",
    connectionIds: [],
    updatedAt: Date.now(),
    messages: [{ role: "assistant" as const, text: "Keep this conversation" }],
  };
  try {
    useAiStore.getState().saveSession(saved);
    await Bun.sleep(200);
    const before = stored.get("l8db.ai");
    expect(before).toContain("Keep this conversation");
    full = true;
    useAiStore.getState().saveSession({
      ...saved,
      id: "quota-new",
      title: "Unsaved conversation",
      messages: [{ role: "assistant", text: "Unsaved response" }],
    });
    await Bun.sleep(200);
    expect(stored.get("l8db.ai")).toBe(before);
    expect(useAiStore.getState().persistenceError).toContain("nicht lokal gespeichert");
    expect(
      useAiStore.getState().sessions.find((session) => session.id === "quota-new")?.messages[0]
        .text,
    ).toBe("Unsaved response");
    full = false;
    useAiStore.getState().saveSession({
      ...saved,
      id: "quota-new",
      deleted: true,
      messages: [],
      updatedAt: Date.now(),
    });
    await Bun.sleep(200);
    expect(useAiStore.getState().persistenceError).toBe("");
    expect(stored.get("l8db.ai")).toContain("Keep this conversation");
    expect(stored.get("l8db.ai")).not.toContain("Unsaved response");
    expect(stored.get("l8db.ai")).not.toContain("persistenceError");
  } finally {
    useAiStore.setState(previous);
    await Bun.sleep(200);
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
