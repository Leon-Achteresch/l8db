import { expect, test } from "bun:test";
import type { Capabilities, ProviderInfo } from "../src/lib/db";

const { FALLBACK_PROVIDERS, POSTGRES_CAPABILITIES, useProvidersStore } = await import(
  "../src/lib/providers"
);
const { supportedCompareObjectTypes } = await import("../src/lib/compare-types");
const { availableTableDetailTabs } = await import("../src/lib/table-detail-tabs");

const fallback = (id: string) => {
  const provider = FALLBACK_PROVIDERS.find((entry: ProviderInfo) => entry.id === id);
  if (!provider) throw new Error(id);
  return provider.capabilities;
};

test("fallback providers do not inherit PostgreSQL-only tools", () => {
  const postgresOnly = [
    "roles",
    "replication",
    "extensions",
    "rls",
    "sequences",
    "enums",
    "health_advisor",
    "debugger",
    "materialized_views",
  ] as const;
  for (const id of ["mysql", "mariadb", "mongodb", "sqlite"])
    for (const capability of postgresOnly) expect(fallback(id)[capability]).toBe(false);
  expect(fallback("mongodb").sessions).toBe(false);
  expect(fallback("mongodb").live_monitor).toBe(false);
  expect(fallback("mongodb").query_language).toBe("json");
  expect(fallback("mongodb").terms.table).toBe("Collection");
  expect(fallback("sqlite").sessions).toBe(false);
  expect(fallback("mysql").database_is_schema).toBe(true);
  expect(fallback("postgres").explain_analyze).toBe(true);
  expect(fallback("sqlite").explain_analyze).toBe(false);
});

test("compare offers packages only where the registry has them", () => {
  const caps = (kind: string, extra: Partial<Capabilities>) =>
    ({
      ...POSTGRES_CAPABILITIES,
      compile_objects: true,
      packages: kind === "oracle",
      ...extra,
    }) as Capabilities;
  useProvidersStore.setState({
    loaded: true,
    providers: [
      { ...FALLBACK_PROVIDERS[0], capabilities: caps("postgres", {}) },
      { ...FALLBACK_PROVIDERS[0], id: "oracle", kind: "oracle", capabilities: caps("oracle", {}) },
    ],
  });
  const connection = (kind: "postgres" | "oracle") =>
    ({ kind }) as Parameters<typeof supportedCompareObjectTypes>[0];
  expect(supportedCompareObjectTypes(connection("postgres"))).not.toContain("package");
  expect(supportedCompareObjectTypes(connection("oracle"))).toContain("package");
});

test("table tabs use the family terms", () => {
  const caps = {
    ...POSTGRES_CAPABILITIES,
    terms: { ...POSTGRES_CAPABILITIES.terms, columns: "Felder" },
  };
  const columns = availableTableDetailTabs(false, caps).find((tab) => tab.id === "columns");
  expect(columns?.label).toBe("Felder");
  expect(
    availableTableDetailTabs(false, POSTGRES_CAPABILITIES).find((tab) => tab.id === "columns")
      ?.label,
  ).toBe("Spalten");
});
