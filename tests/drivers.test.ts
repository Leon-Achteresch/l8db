import { describe, expect, mock, test } from "bun:test";

const calls: Array<{ command: string; args: unknown }> = [];

function provider(
  id: string,
  kind: string,
  driver: Record<string, unknown>,
  status: Record<string, unknown>,
) {
  return {
    id,
    name: id,
    group: kind,
    kind,
    default_port: null,
    file_based: false,
    url_schemes: [],
    placeholder: "",
    hint: "",
    hosts: [],
    driver,
    capabilities: {},
    driver_status: status,
  };
}

const ORACLE_HINTS = [
  {
    os: "macos",
    command: "brew tap InstantClientTap/instantclient && brew install instantclient-basic",
    url: "https://www.oracle.com/database/technologies/instant-client/macos-arm64-downloads.html",
  },
  {
    os: "linux",
    command: "sudo apt install -y unzip libaio1t64 || sudo apt install -y unzip libaio1",
    url: "https://www.oracle.com/database/technologies/instant-client/linux-x86-64-downloads.html",
  },
];

const PROVIDERS = [
  provider(
    "postgres",
    "postgres",
    { type: "builtin" },
    {
      available: true,
      detail: "Eingebetteter Treiber",
      install: [],
      install_command: null,
    },
  ),
  provider(
    "oracle",
    "oracle",
    { type: "runtime_library", library: "Oracle Instant Client" },
    {
      available: false,
      detail: "Oracle Instant Client nicht gefunden",
      install: ORACLE_HINTS,
      install_command: ORACLE_HINTS[0]?.command ?? null,
    },
  ),
  provider(
    "duckdb",
    "duckdb",
    { type: "cargo_feature", feature: "duckdb" },
    {
      available: false,
      detail: "Nicht in diesem Build enthalten",
      install: [
        {
          os: "all",
          command: "bun run tauri build -- --features duckdb",
          url: "https://duckdb.org",
        },
      ],
      install_command: null,
    },
  ),
  provider(
    "odbc",
    "odbc",
    { type: "odbc", driver: "" },
    {
      available: false,
      detail: "ODBC-Treibermanager nicht verfügbar",
      install: [{ os: "macos", command: "brew install unixodbc", url: "https://www.unixodbc.org" }],
      install_command: "brew install unixodbc",
    },
  ),
];

const DIAGNOSIS = {
  status: {
    available: false,
    detail: "Verweis zeigt auf fehlenden Ordner",
    install: ORACLE_HINTS,
    install_command: ORACLE_HINTS[0]?.command ?? null,
  },
  findings: [
    {
      level: "error",
      title: "Verweis zeigt auf fehlenden Ordner",
      detail: "~/lib/libclntsh.dylib → ~/Downloads/instantclient_23_3",
    },
  ],
  steps: ["Tote Verweise entfernen (3)", "Instant Client installieren"],
  manual: null,
};

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: unknown) => {
    calls.push({ command, args });
    if (command === "list_providers") return PROVIDERS;
    if (command === "install_driver") return "Installation abgeschlossen.";
    if (command === "diagnose_driver") return DIAGNOSIS;
    if (command === "repair_driver")
      return { log: "3 von 3 toten Verweisen entfernt.", diagnosis: DIAGNOSIS };
    throw new Error(`unexpected command ${command}`);
  },
}));

const {
  summarizeDrivers,
  missingDrivers,
  hintForPlatform,
  driverTypeLabel,
  platformOs,
  diagnosableKinds,
} = await import("../src/lib/drivers");
const { installDriver, diagnoseDriver, repairDriver } = await import("../src/lib/db");

describe("drivers", () => {
  test("shows missing ODBC manufacturer drivers even when the manager is ready", () => {
    const providers = [
      provider(
        "odbc",
        "odbc",
        { type: "odbc", driver: "" },
        {
          available: true,
          detail: "ODBC-Treibermanager bereit",
          install: [],
          install_command: null,
        },
      ),
      provider(
        "db2",
        "odbc",
        { type: "odbc", driver: "IBM DB2 ODBC DRIVER" },
        {
          available: false,
          detail: "IBM DB2 ODBC DRIVER fehlt",
          install: [],
          install_command: null,
        },
      ),
    ];
    expect(missingDrivers(providers as never).map((entry) => entry.id)).toEqual(["db2"]);
  });

  test("groups providers by family in first-seen order", () => {
    const summaries = summarizeDrivers(PROVIDERS as never, "macos");
    expect(summaries.map((entry) => entry.kind)).toEqual(["postgres", "oracle", "duckdb", "odbc"]);
    expect(summaries[1]?.title).toBe("Oracle");
    expect(summaries[1]?.providers.map((entry) => entry.id)).toEqual(["oracle"]);
  });

  test("marks only backend-installable drivers as installable", () => {
    const summaries = summarizeDrivers(PROVIDERS as never, "macos");
    const byKind = Object.fromEntries(summaries.map((entry) => [entry.kind, entry]));
    expect(byKind.postgres?.installable).toBe(false);
    expect(byKind.oracle?.installable).toBe(true);
    expect(byKind.duckdb?.installable).toBe(false);
    expect(byKind.odbc?.installable).toBe(true);
  });

  test("selects the install hint matching the platform", () => {
    const summaries = summarizeDrivers(PROVIDERS as never, "linux");
    const oracle = summaries.find((entry) => entry.kind === "oracle");
    expect(oracle?.hint?.os).toBe("linux");
    const macSummaries = summarizeDrivers(PROVIDERS as never, "macos");
    expect(macSummaries.find((entry) => entry.kind === "oracle")?.hint?.os).toBe("macos");
    const duckdb = macSummaries.find((entry) => entry.kind === "duckdb");
    expect(duckdb?.hint?.os).toBe("all");
    expect(
      hintForPlatform(
        { available: false, detail: "", install: [], install_command: null },
        "macos",
      ),
    ).toBeUndefined();
  });

  test("labels driver types and detects the platform", () => {
    expect(driverTypeLabel({ type: "builtin" })).toBe("Eingebettet");
    expect(driverTypeLabel({ type: "runtime_library", library: "x" })).toBe("System-Bibliothek");
    expect(driverTypeLabel({ type: "odbc", driver: "" })).toBe("ODBC");
    expect(driverTypeLabel({ type: "cargo_feature", feature: "duckdb" })).toBe(
      "Eingebettet (Build-Feature)",
    );
    expect(platformOs("MacIntel")).toBe("macos");
    expect(platformOs("Win32")).toBe("windows");
    expect(platformOs("Linux x86_64")).toBe("linux");
    expect(platformOs("SomethingElse")).toBe("all");
  });

  test("only runtime libraries are analysed, once per family, within budget", () => {
    const jdbc = provider(
      "jdbc",
      "jdbc",
      { type: "runtime_library", library: "JDK" },
      { available: true, detail: "", install: [], install_command: null },
    );
    expect(diagnosableKinds([...PROVIDERS, jdbc] as never)).toEqual(["oracle"]);
    const many = Array.from({ length: 5000 }, (_, index) =>
      provider(
        `p${index}`,
        index % 2 ? "oracle" : "postgres",
        { type: "builtin" },
        { available: true, detail: "", install: [], install_command: null },
      ),
    );
    const samples: number[] = [];
    for (let run = 0; run < 15; run += 1) {
      const started = performance.now();
      expect(diagnosableKinds(many as never)).toEqual(["oracle"]);
      samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    expect(samples[7]).toBeLessThan(5);
    expect(samples[14]).toBeLessThan(20);
  });

  test("analysis and repair each cost exactly one backend request", async () => {
    calls.length = 0;
    const diagnosis = await diagnoseDriver("oracle");
    expect(diagnosis.steps).toHaveLength(2);
    const repair = await repairDriver("oracle");
    expect(repair.diagnosis.findings[0]?.title).toBe("Verweis zeigt auf fehlenden Ordner");
    expect(calls).toEqual([
      { command: "diagnose_driver", args: { kind: "oracle" } },
      { command: "repair_driver", args: { kind: "oracle" } },
    ]);
  });

  test("installDriver invokes the backend command", async () => {
    calls.length = 0;
    await expect(installDriver("oracle")).resolves.toBe("Installation abgeschlossen.");
    expect(calls).toEqual([{ command: "install_driver", args: { kind: "oracle" } }]);
  });
});
