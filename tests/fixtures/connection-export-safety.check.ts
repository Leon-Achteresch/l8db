import { describe, expect, mock, test } from "bun:test";

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => (command === "list_providers" ? [] : null),
  Resource: class {},
  Channel: class {},
  transformCallback: () => 0,
}));
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "window", {
  value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  },
  configurable: true,
});

const { buildConnectionExport, parseConnectionImport, resolveImport } = await import(
  "../../src/lib/connection-export"
);
const { mergeVaultConnections, toVaultConnection } = await import(
  "../../src/lib/connection-export/vault"
);

const maskRules = [
  { name: "Mail", pattern: "*email*", enabled: true, mask: "partial" as const },
  { name: "IBAN", pattern: "iban", enabled: false, mask: null },
];

const production = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  name: "Prod",
  kind: "postgres" as const,
  connectionString: "postgres://app:pw@db.example.com:5432/prod",
  sslMode: "require" as const,
  ssh: null,
  proxy: null,
  tunnelPort: null,
  tags: [],
  favorite: false,
  color: null,
  schemas: null,
  showSingleSchemaSwitcher: true,
  readOnly: true,
  environment: "production" as const,
  maskRules,
  proxyUser: "auditor",
};

function roundTrip(connection: typeof production) {
  const text = JSON.stringify(buildConnectionExport([connection]));
  const parsed = parseConnectionImport(text, []);
  return resolveImport(parsed.candidates, new Set([0]), "skip")[0];
}

describe("connection export keeps safety settings", () => {
  test("file export and import keep environment, read-only and masking rules", () => {
    const file = buildConnectionExport([production]);
    expect(file.connections[0].environment).toBe("production");
    expect(file.connections[0].readOnly).toBe(true);
    expect(file.connections[0].maskRules).toEqual(maskRules);
    const imported = roundTrip(production);
    expect(imported.environment).toBe("production");
    expect(imported.readOnly).toBe(true);
    expect(imported.maskRules).toEqual(maskRules);
  });

  test("connections without safety settings import without them", () => {
    const imported = roundTrip({
      ...production,
      readOnly: undefined as unknown as boolean,
      environment: undefined as unknown as "production",
      maskRules: undefined as unknown as typeof maskRules,
    });
    expect(imported.environment ?? null).toBeNull();
    expect(imported.readOnly ?? false).toBe(false);
    expect(imported.maskRules ?? []).toEqual([]);
  });

  test("invalid safety values from a file are ignored", () => {
    const text = JSON.stringify({
      format: "l8db-connections",
      version: 1,
      connections: [
        {
          id: "x",
          name: "X",
          kind: "postgres",
          connectionString: "postgres://u@h/db",
          environment: "prod",
          readOnly: "yes",
          maskRules: [{ name: 1 }, { name: "Ok", pattern: "ssn", enabled: true, mask: "bogus" }],
        },
      ],
    });
    const [imported] = resolveImport(
      parseConnectionImport(text, []).candidates,
      new Set([0]),
      "skip",
    );
    expect(imported.environment ?? null).toBeNull();
    expect(imported.readOnly ?? false).toBe(false);
    expect(imported.maskRules).toEqual([{ name: "Ok", pattern: "ssn", enabled: true, mask: null }]);
  });

  test("a shared production connection arrives protected from the vault", () => {
    const merge = mergeVaultConnections([toVaultConnection(production, null)], []);
    const added = merge.added[0];
    expect(added.environment).toBe("production");
    expect(added.readOnly).toBe(true);
    expect(added.maskRules).toEqual(maskRules);
  });

  test("a vault update propagates new protection to an existing connection", () => {
    const local = { ...production, environment: null, readOnly: false, maskRules: [] };
    const merge = mergeVaultConnections([toVaultConnection(production, null)], [local]);
    const updated = merge.updated[0];
    expect(updated.environment).toBe("production");
    expect(updated.readOnly).toBe(true);
    expect(updated.maskRules).toEqual(maskRules);
  });

  test("a vault update never weakens local protection", () => {
    const remote = toVaultConnection(
      { ...production, environment: "development" as never, readOnly: false, maskRules: [] },
      null,
    );
    const merge = mergeVaultConnections([remote], [production]);
    const updated = merge.updated[0];
    expect(updated.environment).toBe("production");
    expect(updated.readOnly).toBe(true);
    expect(updated.maskRules).toEqual(maskRules);
    expect(updated.proxyUser).toBe("auditor");
  });

  test("a vault entry from an older version keeps local protection", () => {
    const legacy = toVaultConnection(production, null);
    const profile = { ...(legacy.profile as Record<string, unknown>) };
    delete profile.environment;
    delete profile.readOnly;
    delete profile.maskRules;
    const merge = mergeVaultConnections([{ ...legacy, profile }], [production]);
    const updated = merge.updated[0];
    expect(updated.environment).toBe("production");
    expect(updated.readOnly).toBe(true);
    expect(updated.maskRules).toEqual(maskRules);
  });
});
