import { expect, mock, test } from "bun:test";

const queries: { kind: string; sql: string }[] = [];
const answers: Record<string, Record<string, unknown>[]> = {};

function provider(id: string, kind: string, capabilities: Record<string, unknown>) {
  return {
    id,
    name: id,
    group: kind,
    kind,
    default_port: null,
    file_based: false,
    url_schemes: [kind],
    placeholder: "",
    hint: "",
    hosts: id === kind ? ["localhost", "127.0.0.1"] : [],
    driver: { type: "builtin" },
    capabilities,
    driver_status: { available: true, detail: "", install: [] },
  };
}

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown>) => {
    if (command === "list_providers")
      return [
        provider("postgres", "postgres", { replication: true }),
        provider("cockroachdb", "postgres", { replication: false }),
        provider("timescale", "postgres", { replication: true }),
        provider("redis", "redis", {}),
        provider("dragonfly", "redis", {}),
        provider("mysql", "mysql", { sequences: false }),
        provider("mariadb", "mysql", { sequences: true }),
      ];
    if (command === "execute_query") {
      queries.push({ kind: String(args.kind), sql: String(args.sql) });
      return { columns: [], rows: answers[String(args.connectionString)] ?? [] };
    }
    return null;
  },
}));

const { loadProviders, supports } = await import("../src/lib/providers");
await loadProviders();
const { detectServerProduct } = await import("../src/lib/ssh/server-product");
const { productFromProbe, serverProduct } = await import("../src/lib/server-products");
const { providerFor } = await import("../src/lib/connection-url");
const { matchProduct } = await import("../src/lib/connection-import/products");

function connection(kind: string, connectionString: string) {
  return { id: connectionString, name: "lab", kind, connectionString } as never;
}

test("server versions name wire-compatible products", () => {
  expect(
    productFromProbe("postgres", [{ version: "CockroachDB CCL v26.4.0", timescale: false }]),
  ).toBe("cockroachdb");
  expect(productFromProbe("postgres", [{ version: "PostgreSQL 17.6", timescale: true }])).toBe(
    "timescale",
  );
  expect(productFromProbe("postgres", [{ version: "PostgreSQL 18.1", timescale: false }])).toBe(
    null,
  );
  expect(
    productFromProbe("redis", [{ section: "server", key: "dragonfly_version", value: "df-v1" }]),
  ).toBe("dragonfly");
  expect(productFromProbe("redis", [{ result: "redis_version:7.4.0" }])).toBe(null);
  expect(productFromProbe("mysql", [{ version: "11.4.2-MariaDB-ubu2404" }])).toBe("mariadb");
  expect(productFromProbe("mysql", [{ version: "8.4.3" }])).toBe(null);
});

test("activation probes each server once and switches the provider", async () => {
  const crdb = "postgresql://root@127.0.0.1:26357/defaultdb";
  const pg = "postgresql://postgres@127.0.0.1:15435/postgres";
  const dragonfly = "redis://127.0.0.1:16390/0";
  answers[crdb] = [{ version: "CockroachDB CCL v26.4.0", timescale: false }];
  answers[pg] = [{ version: "PostgreSQL 18.1", timescale: false }];
  answers[dragonfly] = [{ result: "# Server\r\ndragonfly_version:df-v1.34" }];
  const maria = "mysql://root@127.0.0.1:13306/app";
  answers[maria] = [{ version: "11.4.2-MariaDB" }];
  answers["mysql://root@127.0.0.1/app"] = [{ version: "8.4.3" }];
  queries.length = 0;
  for (const [kind, url] of [
    ["postgres", crdb],
    ["postgres", pg],
    ["redis", dragonfly],
    ["mysql", "mysql://root@127.0.0.1/app"],
    ["mysql", maria],
  ])
    await detectServerProduct(connection(kind, url));
  expect(queries.length).toBe(5);
  expect(queries.map((entry) => entry.kind)).toEqual([
    "postgres",
    "postgres",
    "redis",
    "mysql",
    "mysql",
  ]);
  expect(serverProduct(crdb)).toBe("cockroachdb");
  expect(serverProduct(pg)).toBeUndefined();
  expect(providerFor(connection("postgres", crdb)).id).toBe("cockroachdb");
  expect(providerFor(connection("postgres", crdb)).capabilities.replication).toBe(false);
  expect(providerFor(connection("postgres", pg)).id).toBe("postgres");
  expect(providerFor(connection("redis", dragonfly)).id).toBe("dragonfly");
  expect(providerFor(connection("mysql", maria)).capabilities.sequences).toBe(true);
  expect(
    providerFor(connection("mysql", "mysql://root@127.0.0.1/app")).capabilities.sequences,
  ).toBe(false);
  expect(supports(connection("postgres", crdb), "replication")).toBe(false);
  expect(supports(connection("postgres", pg), "replication")).toBe(true);
  expect(supports(connection("mysql", maria), "sequences")).toBe(true);
});

test("connection import keeps the product it names", () => {
  expect(matchProduct("dragonfly")?.label).toBe("Dragonfly");
  expect(matchProduct("valkey")?.label).toBe("Valkey");
  expect(matchProduct("FerretDB")?.label).toBe("FerretDB");
  expect(matchProduct("Amazon DocumentDB")?.label).toBe("Amazon DocumentDB");
  expect(matchProduct("ScyllaDB")?.label).toBe("ScyllaDB");
  expect(matchProduct("aurora")?.label).toBe("Aurora MySQL");
  expect(matchProduct("redis")?.label).toBe("Redis");
  expect(matchProduct("mongodb")?.label).toBe("MongoDB");
});
