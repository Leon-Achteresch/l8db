import { afterEach, describe, expect, mock, test } from "bun:test";
import { arch, cpus, platform, totalmem } from "node:os";
import type { ConnectionInputActionsContext } from "../../src/features/connections/connection-editor/connection-input-actions";
import type { SavedConnection } from "../../src/lib/connections/types";

const calls: { command: string; args: Record<string, unknown> | undefined }[] = [];
let registryFailure = true;
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    if (command === "list_providers") {
      if (registryFailure) throw new Error("Registry unavailable");
      return [];
    }
    if (command === "load_secret") return "frontend-secret";
    return null;
  },
  Resource: class {},
  Channel: class {},
  transformCallback: () => 0,
}));
mock.module("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
mock.module("@tauri-apps/plugin-dialog", () => ({ open: async () => null }));
const storage = new Map<string, string>();
const localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
};
Object.defineProperty(globalThis, "window", {
  value: { localStorage, addEventListener: () => {}, removeEventListener: () => {} },
  configurable: true,
});
Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });

const { connectionSummary, connectionUrlString, detectProvider, kindFromUrl, parseConnectionUrl } =
  await import("../../src/lib/connection-url");
const { capabilitiesFor, FALLBACK_PROVIDERS, loadProviders, providerForKind } = await import(
  "../../src/lib/providers"
);
const { buildConnectionExport, parseConnectionImport, resolveImport } = await import(
  "../../src/lib/connection-export"
);
const { useConnectionsStore } = await import("../../src/lib/connections/store");
const { initConnectionSecrets, isReadOnlyConnection } = await import(
  "../../src/lib/connections/secrets"
);
const { effectiveConnectionString } = await import("../../src/lib/ssh/connection-string");
const { buildAutomationConnection } = await import("../../src/lib/automation/sync");
const { seedFields, seedMode } = await import(
  "../../src/features/connections/connection-editor/seed"
);
const { createConnectionInputActions } = await import(
  "../../src/features/connections/connection-editor/connection-input-actions"
);
const { databasePasswordToSave } = await import(
  "../../src/features/connections/connection-editor/connection-operations"
);
const { storeSecret } = await import("../../src/lib/secrets");
const { prepareConnection } = await import("../../src/lib/prepare-connection");

function connection(kind: "jdbc" | "workspace" | "spacetimedb", index = 1): SavedConnection {
  return {
    id: `managed-${kind}-${index}`,
    name: `${kind} ${index}`,
    kind,
    connectionString:
      kind === "jdbc"
        ? `jdbc:l8db:profile_${index}`
        : kind === "workspace"
          ? `workspace://team_${index}/database_${index}`
          : "spacetimedb://token@maincloud.spacetimedb.com/example",
    sslMode: "prefer",
    readOnly: true,
    environment: "production",
    ssh: null,
    tunnelPort: null,
    schemas: ["Reporting"],
    maskRules: [{ name: "Email", pattern: "*email*", enabled: true, mask: "partial" }],
  };
}

afterEach(() => {
  useConnectionsStore.setState({ connections: [], activeId: null });
});

describe("managed connection integration", () => {
  test("provider failures preserve kind detection with conservative JDBC availability", async () => {
    await loadProviders();
    for (const kind of ["jdbc", "workspace", "spacetimedb"] as const) {
      const saved = connection(kind);
      expect(kindFromUrl(saved.connectionString)).toBe(kind);
      expect(detectProvider(saved.connectionString)).toBe(kind);
      expect(capabilitiesFor(kind).read_only_mode).toBe(false);
      expect(capabilitiesFor(kind).ssh).toBe(false);
    }
    expect(providerForKind("jdbc")?.driver_status.available).toBe(false);
    registryFailure = false;
    await loadProviders();
    expect(providerForKind("workspace")?.kind).toBe("workspace");
  });

  test("opaque JDBC pointers round trip and reject URLs, credentials and modifiers", () => {
    for (const id of ["x", "AbC_19-z", "a".repeat(80)]) {
      const pointer = `jdbc:l8db:${id}`;
      expect(parseConnectionUrl(pointer).hostname).toBe("");
      expect(connectionUrlString(` ${pointer} `)).toBe(pointer);
      expect(connectionSummary(pointer)).toEqual({
        host: "JDBC-Profil",
        port: "",
        database: id,
        user: "",
      });
    }
    for (const pointer of [
      "jdbc:l8db:",
      `jdbc:l8db:${"a".repeat(81)}`,
      "jdbc:l8db:a?options=unsafe",
      "jdbc:l8db:a#b",
      "jdbc:l8db:a/b",
      "jdbc:l8db:a%2Fb",
      "jdbc:postgresql://user:secret@host/db",
      "jdbc://host/profile",
    ])
      expect(() => parseConnectionUrl(pointer, "jdbc")).toThrow();
  });

  test("workspace pointers retain exact identifiers and reject credentials or network modifiers", () => {
    const pointer = "workspace://Team_17/Database-X";
    expect(connectionUrlString(pointer, "workspace")).toBe(pointer);
    expect(connectionSummary(pointer, "workspace")).toEqual({
      host: "Workspace Team_17",
      port: "",
      database: "Database-X",
      user: "",
    });
    for (const value of [
      "workspace://profile/",
      "workspace://profile/a/b",
      "workspace://profile/a?x=y",
      "workspace://profile/a#x",
      "workspace://user:secret@profile/a",
      "workspace://profile:123/a",
      "workspace://profile/%2e%2e",
      "workspace://profile/../a",
    ])
      expect(() => parseConnectionUrl(value, "workspace")).toThrow();
    expect(connectionSummary("workspace://user:secret@profile/a", "workspace").host).not.toContain(
      "secret",
    );
  });

  test("profile editing seeds URL mode and switching from Oracle TNS stays in URL mode", () => {
    for (const kind of ["jdbc", "workspace"] as const) {
      const info = providerForKind(kind);
      if (!info) throw new Error(`Missing provider ${kind}`);
      expect(seedMode(connection(kind), info)).toBe("string");
      expect(seedMode(undefined, info)).toBe("string");
      expect(seedFields(connection(kind), info, false)).toMatchObject({
        host: "",
        port: "",
        user: "",
        password: "",
      });
      const modes: string[] = [];
      const values: string[] = [];
      const noop = () => {};
      const ctx: ConnectionInputActionsContext = {
        providers: FALLBACK_PROVIDERS,
        mode: "tns",
        value: "oracle://app@host/service",
        kind: "oracle",
        info,
        step: 2,
        makeUrl: () => "",
        setMode: (mode) => {
          modes.push(mode);
        },
        setValue: (value) => {
          values.push(value);
        },
        setProvider: noop,
        setPreview: noop,
        setResult: noop,
        setHost: noop,
        setPort: noop,
        setDatabase: noop,
        setUser: noop,
        setPassword: noop,
        setExtraParams: noop,
        setTrusted: noop,
        setFile: noop,
        setTnsAlias: noop,
        setSsl: noop,
        setStep: noop,
      };
      createConnectionInputActions(ctx).selectProvider(kind);
      expect(modes).toEqual(["string"]);
      expect(values).toEqual([""]);
      const errors: unknown[] = [];
      createConnectionInputActions({
        ...ctx,
        mode: "string",
        kind,
        value: connection(kind).connectionString,
        setResult: (result) => {
          errors.push(result);
        },
      }).switchMode("fields");
      expect(errors).toEqual([expect.objectContaining({ status: "error" })]);
    }
  });

  test("cached frontend secrets never change profile pointers or enter password-save flow", async () => {
    for (const kind of ["jdbc", "workspace"] as const) {
      const saved = connection(kind);
      await storeSecret(saved.id, "cached-frontend-secret");
      const before = calls.length;
      expect(effectiveConnectionString(saved)).toBe(saved.connectionString);
      expect(await databasePasswordToSave(saved.connectionString, saved)).toBeNull();
      expect(calls).toHaveLength(before);
    }
  });

  test("automation preserves pointers, production restrictions, schemas and masking", () => {
    for (const kind of ["jdbc", "workspace"] as const) {
      const saved = connection(kind);
      const mirrored = buildAutomationConnection(saved);
      expect(mirrored.connectionString).toBe(saved.connectionString);
      expect(mirrored.readOnly).toBe(true);
      expect(mirrored.schemas).toEqual(saved.schemas);
      expect(mirrored.maskRules).toEqual(saved.maskRules);
      expect(mirrored.connectionString).not.toContain("options=");
    }
  });

  test("startup skips normal secrets and prepare rejects stale profile tunnels before network requests", async () => {
    const saved = [connection("jdbc"), connection("workspace")];
    useConnectionsStore.setState({ connections: saved, activeId: null });
    const before = calls.length;
    await initConnectionSecrets();
    expect(calls.slice(before).filter((call) => call.command.endsWith("secret"))).toHaveLength(0);
    expect(
      useConnectionsStore.getState().connections.map((entry) => entry.connectionString),
    ).toEqual(saved.map((entry) => entry.connectionString));
    for (const entry of saved) {
      const stale = {
        ...entry,
        proxy: { type: "socks5" as const, host: "proxy", port: 1080 },
        tunnelPort: 1234,
      };
      expect(() => effectiveConnectionString(stale)).toThrow("Profil");
      useConnectionsStore.setState({ connections: [stale] });
      const beforePrepare = calls.length;
      await expect(prepareConnection(stale.id)).rejects.toThrow("Profil");
      expect(calls).toHaveLength(beforePrepare);
    }
  });

  test("exports preserve profile references and safety while imports reject modifiers", () => {
    for (const kind of ["jdbc", "workspace"] as const) {
      const saved = connection(kind);
      const exported = buildConnectionExport([saved]);
      const parsed = parseConnectionImport(JSON.stringify(exported), []);
      expect(parsed.error).toBeNull();
      expect(parsed.candidates[0].error).toBeNull();
      expect(resolveImport(parsed.candidates, new Set([0]), "skip")[0]).toMatchObject({
        kind,
        connectionString: saved.connectionString,
        schemas: saved.schemas,
        maskRules: saved.maskRules,
        readOnly: true,
        environment: "production",
      });
      for (const modifiers of [
        {
          connectionString:
            kind === "jdbc" ? "jdbc:l8db:id?password=secret" : "workspace://user:secret@team/db",
        },
        { proxy: { type: "socks5", host: "proxy", port: 1080 } },
        { cloudAuth: { mode: "aws_iam" } },
        { proxyUser: "other" },
      ]) {
        const invalid = parseConnectionImport(
          JSON.stringify({
            ...exported,
            connections: [{ ...exported.connections[0], ...modifiers }],
          }),
          [],
        );
        expect(invalid.candidates[0].error).not.toBeNull();
      }
    }
  });

  test("SpacetimeDB is read-only and validates databases and identity-token placement", () => {
    const saved = { ...connection("spacetimedb"), readOnly: false };
    expect(isReadOnlyConnection(saved)).toBe(true);
    expect(buildAutomationConnection(saved).readOnly).toBe(true);
    expect(effectiveConnectionString(saved)).not.toContain("options=");
    expect(
      parseConnectionUrl("spacetimedb://token:identity@127.0.0.1:3000/database?tls=false").port,
    ).toBe("3000");
    for (const url of [
      "spacetimedb://host/",
      "spacetimedb://host/a/b",
      "spacetimedb://host/a%20b",
      "spacetimedb://host/db?token=secret",
      "spacetimedb://host/db?authToken=secret",
    ])
      expect(() => parseConnectionUrl(url, "spacetimedb")).toThrow();
    const parsed = parseConnectionImport(JSON.stringify(buildConnectionExport([saved])), []);
    expect(parsed.candidates[0].profile?.readOnly).toBe(true);
  });
});

test("perf: 10 000 profile pointers bound latency, heap, retained summaries, database calls and idle work", async () => {
  const profiles = Array.from({ length: 10_000 }, (_, index) =>
    connection(index % 2 ? "jdbc" : "workspace", index),
  );
  const retained = new Set<string>();
  const samples: number[] = [];
  const before = calls.length;
  const heapBefore = process.memoryUsage().heapUsed;
  for (let run = 0; run < 11; run++) {
    const started = performance.now();
    let produced = 0;
    for (const saved of profiles) {
      const pointer = connectionUrlString(saved.connectionString, saved.kind);
      const summary = connectionSummary(pointer, saved.kind);
      if (!summary.host) throw new Error("Empty profile summary");
      if (buildAutomationConnection(saved).connectionString !== pointer)
        throw new Error("Mutated profile pointer");
      produced++;
      if (retained.size < 100) retained.add(summary.host);
    }
    expect(produced).toBe(10_000);
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const median = samples[5];
  const p95 = samples[10];
  const heapDelta = Math.max(0, process.memoryUsage().heapUsed - heapBefore);
  expect(median).toBeLessThan(750);
  expect(p95).toBeLessThan(1250);
  expect(heapDelta).toBeLessThan(64 * 1024 * 1024);
  expect(retained.size).toBeLessThanOrEqual(100);
  expect(calls.slice(before).filter((call) => call.command !== "list_providers")).toHaveLength(0);
  const idle = calls.length;
  await Bun.sleep(30);
  expect(calls).toHaveLength(idle);
  console.log(
    JSON.stringify({
      feature: "managed-connection-pointers",
      profiles: profiles.length,
      runs: samples.length,
      medianMs: median,
      p95Ms: p95,
      heapDeltaBytes: heapDelta,
      retainedSummaries: retained.size,
      dbRequests: 0,
      idleRequests: 0,
      environment: {
        os: platform(),
        architecture: arch(),
        cpu: cpus()[0]?.model,
        ramBytes: totalmem(),
        bun: Bun.version,
      },
    }),
  );
}, 30000);
