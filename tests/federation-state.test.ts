import { describe, expect, test } from "bun:test";
import {
  federationExample,
  federationNameOptions,
  federationProblem,
  newFederationSource,
} from "../src/features/federation/federation-state";
import { FEDERATION_LIMITS, type FederationSource } from "../src/lib/db/federation-types";

const source: FederationSource = {
  connectionId: "crm-id",
  database: "crm-db",
  schema: "public",
  table: "customers",
  alias: "crm",
};

describe("federated source selection", () => {
  test("requires complete sources and unique source aliases", () => {
    expect(federationProblem([source], "SELECT * FROM crm.customers")).toBeNull();
    expect(federationProblem([], "SELECT 1")).toContain("Quelltabellen");
    expect(federationProblem([{ ...source, connectionId: "" }], "SELECT 1")).toContain(
      "Verbindung",
    );
    expect(federationProblem([source, source], "SELECT 1")).toContain("doppelt");
    expect(federationProblem([source, { ...source, table: "orders" }], "SELECT 1")).toBeNull();
    expect(
      federationProblem(
        [source, { ...source, alias: "CRM", database: "other", table: "orders" }],
        "SELECT 1",
      ),
    ).toContain("unterschiedliche");
    for (const alias of ["main", "temp", "sqlite_master", "1bad", "has-dash", "x; DROP", ""]) {
      expect(federationProblem([{ ...source, alias }], "SELECT 1")).toContain("Aliase");
    }
    expect(
      federationProblem(
        Array.from({ length: FEDERATION_LIMITS.sources + 1 }, () => source),
        "SELECT 1",
      ),
    ).toContain("Quelltabellen");
    expect(federationProblem([source], "ä".repeat(FEDERATION_LIMITS.sqlBytes / 2 + 1))).toContain(
      "64 KiB",
    );
  });

  test("generates collision-free aliases and quotes real table names", () => {
    expect(newFederationSource([]).alias).toBe("quelle1");
    expect(
      newFederationSource([
        { ...source, alias: "QUELLE1" },
        { ...source, alias: "quelle2" },
      ]).alias,
    ).toBe("quelle3");
    expect(federationExample([{ ...source, table: 'customer"names' }])).toBe(
      'SELECT *\nFROM "crm"."customer""names"\nLIMIT 100;',
    );
    expect(federationExample([])).toContain("quelle1.kunden");
  });

  test("bounds suggestion DOM while preserving access to late matching names", () => {
    const names = Array.from({ length: 50_000 }, (_, index) => `table_${index}`);
    expect(federationNameOptions(names, "")).toHaveLength(100);
    expect(federationNameOptions(names, "table_49999")).toEqual(["table_49999"]);
    expect(
      federationNameOptions(["id-1", "id-2"], "ANALYTICS", (id) =>
        id === "id-2" ? "Analytics" : "CRM",
      ),
    ).toEqual(["id-2"]);
  });
});

test("perf: suggestion search over 50 000 source names stays within latency and retention budgets", () => {
  const names = Array.from({ length: 50_000 }, (_, index) => `schema_table_${index}`);
  const samples: number[] = [];
  let retained = 0;
  for (let run = 0; run < 31; run++) {
    const started = performance.now();
    const matches = federationNameOptions(names, run % 2 ? "schema_table_49999" : "schema_table");
    samples.push(performance.now() - started);
    retained = Math.max(retained, matches.length);
  }
  samples.sort((left, right) => left - right);
  const median = samples[15];
  const p95 = samples[29];
  console.log(
    `federation suggestions: 50 000 names, median ${median.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms; limits 15/30 ms, retained <=100 suggestions, zero database reads`,
  );
  expect(median).toBeLessThan(15);
  expect(p95).toBeLessThan(30);
  expect(retained).toBeLessThanOrEqual(100);
});
