import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("@tauri-apps/api/core", () => ({
  invoke: async () => {
    throw new Error("not available in tests");
  },
}));

const {
  buildDiagnosticsPackage,
  clearDiagnosticErrors,
  collectSystemInfo,
  DIAGNOSTICS_FORMAT,
  driverDiagnostics,
  maskHost,
  providerDiagnostics,
  recentDiagnosticErrors,
  recordDiagnosticError,
  redactConnection,
  redactErrorMessage,
  redactSettings,
  serializeDiagnostics,
} = await import("@/lib/diagnostics");

type AnyRecord = Record<string, unknown>;

function provider(id: string, kind: string, available: boolean): AnyRecord {
  return {
    id,
    name: id,
    group: "sql",
    kind,
    default_port: 5432,
    file_based: false,
    url_schemes: [],
    placeholder: "",
    hint: "",
    hosts: [],
    driver: { type: "builtin" },
    capabilities: {},
    driver_status: { available, detail: available ? "ok" : "fehlt", install: [] },
  };
}

function connection(overrides: AnyRecord = {}): AnyRecord {
  return {
    id: "c1",
    name: "Prod",
    kind: "postgres",
    connectionString: "postgres://admin:s3cret@db.example.com:5432/shop?sslmode=require",
    sslMode: "require",
    ssh: null,
    tunnelPort: null,
    tags: [{ name: "prod", color: "#fff" }],
    favorite: false,
    color: null,
    ...overrides,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: Testdaten werden bewusst lose typisiert
const asAny = (value: unknown) => value as any;

describe("maskHost", () => {
  test("lässt lokale Hosts unverändert", () => {
    expect(maskHost("localhost")).toBe("localhost");
    expect(maskHost("127.0.0.1")).toBe("127.0.0.1");
  });

  test("maskiert Domains und IPs", () => {
    expect(maskHost("db.example.com")).toBe("d***.e***.com");
    expect(maskHost("intern")).toBe("i***");
    expect(maskHost("10.20.30.40")).toBe("10.x.x.x");
    expect(maskHost("2001:db8::1")).toBe("ip6-masked");
    expect(maskHost("")).toBe("");
  });
});

describe("redactConnection", () => {
  test("entfernt Zugangsdaten und maskiert Host", () => {
    const result = redactConnection(asAny(connection()));
    expect(result).toEqual({
      name: "Prod",
      kind: "postgres",
      scheme: "postgres",
      host: "d***.e***.com",
      port: 5432,
      sslMode: "require",
      usesSsh: false,
      tagCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain("s3cret");
    expect(JSON.stringify(result)).not.toContain("shop");
  });

  test("versteht DSN-Syntax und SSH-Kennzeichnung", () => {
    const result = redactConnection(
      asAny(
        connection({
          kind: "mssql",
          connectionString: "Server=sql.intern.net,1433;Database=x;User Id=sa;Password=p",
          ssh: { host: "bastion.example.com", port: 22, user: "u", auth: "key" },
        }),
      ),
    );
    expect(result.scheme).toBe("");
    expect(result.host).toBe("s***.i***.net");
    expect(result.port).toBe(1433);
    expect(result.usesSsh).toBe(true);
  });
});

describe("redactErrorMessage", () => {
  test("entfernt URLs und Geheimnisse", () => {
    const message = redactErrorMessage(
      "connect postgres://user:hunter2@db.example.com:5432/app failed, password=hunter2",
    );
    expect(message).not.toContain("hunter2");
    expect(message).not.toContain("user:");
    expect(message).toContain("d***.e***.com");
    expect(message).toContain("<redacted>");
  });

  test("kürzt sehr lange Meldungen", () => {
    expect(redactErrorMessage("x".repeat(900)).length).toBe(500);
  });
});

describe("Fehlerprotokoll", () => {
  beforeEach(() => clearDiagnosticErrors());

  test("speichert redigiert und begrenzt auf 20", () => {
    recordDiagnosticError("test", "token=abc123");
    expect(recentDiagnosticErrors()[0]?.message).not.toContain("abc123");
    for (let i = 0; i < 30; i += 1) recordDiagnosticError("test", `E${i}`);
    expect(recentDiagnosticErrors()).toHaveLength(20);
    expect(recentDiagnosticErrors()[0]?.message).toBe("E29");
  });
});

describe("Paketaufbau", () => {
  const providers = [
    provider("pg", "postgres", true),
    provider("pg2", "postgres", true),
    provider("my", "mysql", false),
  ];
  const input = {
    app: { name: "l8db", version: "0.1.0" },
    system: { os: "macos", platform: "MacIntel", language: "de", timezone: "Europe/Berlin" },
    providers: asAny(providers),
    connections: asAny([connection()]),
    settings: asAny({ rowLimit: 100, setRowLimit: () => undefined }),
    errors: [{ at: "2026-01-01T00:00:00.000Z", source: "test", message: "boom" }],
    warnings: ["Treiberstatus nicht lesbar"],
  };

  test("nimmt nur gewählte Abschnitte auf", () => {
    const pkg = buildDiagnosticsPackage(input, ["app", "connections"], new Date(0));
    expect(pkg.format).toBe(DIAGNOSTICS_FORMAT);
    expect(pkg.createdAt).toBe("1970-01-01T00:00:00.000Z");
    expect(pkg.sections).toEqual(["app", "connections"]);
    expect(pkg.app?.version).toBe("0.1.0");
    expect(pkg.connections).toHaveLength(1);
    expect(pkg.settings).toBeUndefined();
    expect(pkg.errors).toBeUndefined();
    expect(pkg.warnings).toEqual(["Treiberstatus nicht lesbar"]);
  });

  test("Treiber werden je Familie zusammengefasst", () => {
    const drivers = driverDiagnostics(asAny(providers));
    expect(drivers.map((entry) => entry.kind)).toEqual(["postgres", "mysql"]);
    expect(drivers[0]?.title).toBe("PostgreSQL");
    expect(drivers[1]?.available).toBe(false);
    expect(providerDiagnostics(asAny(providers))).toHaveLength(3);
  });

  test("Einstellungen ohne Funktionen", () => {
    expect(redactSettings(asAny(input.settings))).toEqual({ rowLimit: 100 });
  });

  test("Serialisierung enthält keine Geheimnisse", () => {
    const text = serializeDiagnostics(
      buildDiagnosticsPackage(input, [
        "app",
        "system",
        "drivers",
        "providers",
        "connections",
        "settings",
        "errors",
      ]),
    );
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain("db.example.com");
    expect(JSON.parse(text).sections).toHaveLength(7);
  });

  test("collectSystemInfo liefert Plattformdaten", () => {
    const system = collectSystemInfo();
    expect(typeof system.os).toBe("string");
    expect(typeof system.language).toBe("string");
  });
});
