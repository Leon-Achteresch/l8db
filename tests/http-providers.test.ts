import { expect, mock, test } from "bun:test";

function provider(id: string, kind: string, schemes: string[], hosts: string[]) {
  return {
    id,
    name: id,
    group: kind,
    kind,
    default_port: null,
    file_based: false,
    url_schemes: schemes,
    placeholder: "",
    hint: "",
    hosts,
    driver: { type: "builtin" },
    capabilities: { ssl: kind !== "sqlite_http", ssh: kind !== "sqlite_http" },
    driver_status: { available: true, detail: "", install: [], install_command: null },
  };
}

const PROVIDERS = [
  provider("postgres", "postgres", ["postgresql", "postgres"], ["localhost"]),
  provider("mysql", "mysql", ["mysql", "mariadb"], ["localhost"]),
  provider("mariadb", "mysql", ["mysql", "mariadb"], [".mariadb.com"]),
  provider("turso", "sqlite_http", ["libsql", "d1"], [".turso.io"]),
  provider("d1", "sqlite_http", ["libsql", "d1"], ["api.cloudflare.com"]),
  provider("clickhouse", "clickhouse", ["clickhouse", "http", "https"], [".clickhouse.cloud"]),
  provider("influxdb", "influxdb", ["influxdb", "https", "http"], [".influxdata.com"]),
  provider(
    "elasticsearch",
    "elasticsearch",
    ["elasticsearch", "opensearch", "https", "http"],
    [".elastic-cloud.com"],
  ),
  provider(
    "opensearch",
    "elasticsearch",
    ["elasticsearch", "opensearch", "https", "http"],
    [".es.amazonaws.com"],
  ),
];

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => (command === "list_providers" ? PROVIDERS : null),
}));

const { loadProviders } = await import("../src/lib/providers");
await loadProviders();
const { connectionSummary, detectProvider, kindFromUrl, parseConnectionUrl } = await import(
  "../src/lib/connection-url"
);
const { compileSingleCondition } = await import("../src/lib/sql-filter");

test("generic HTTP URLs keep ClickHouse unless a cloud host identifies another family", () => {
  expect(kindFromUrl("https://ch.example.com:8443/db")).toBe("clickhouse");
  expect(kindFromUrl("https://abc.eu-west-1.aws.elastic-cloud.com:443")).toBe("elasticsearch");
  expect(kindFromUrl("https://eu-central-1-1.aws.cloud2.influxdata.com")).toBe("influxdb");
  expect(detectProvider("https://search-logs.eu-central-1.es.amazonaws.com")).toBe("opensearch");
});

test("dedicated schemes select family and matching provider", () => {
  expect(kindFromUrl("elasticsearch://elastic:pw@localhost:9200")).toBe("elasticsearch");
  expect(detectProvider("elasticsearch://localhost:9200")).toBe("elasticsearch");
  expect(detectProvider("opensearch://admin:pw@localhost:9200")).toBe("opensearch");
  expect(kindFromUrl("influxdb://token:t@localhost:8086/metrics")).toBe("influxdb");
  expect(kindFromUrl("libsql://db-org.turso.io")).toBe("sqlite_http");
  expect(detectProvider("libsql://127.0.0.1:8080?tls=false")).toBe("turso");
  expect(detectProvider("d1://acc:token@api.cloudflare.com/shop")).toBe("d1");
  expect(detectProvider("mariadb://root@db.mariadb.com/db")).toBe("mariadb");
});

test("parses and summarizes HTTP connection URLs", () => {
  expect(() => parseConnectionUrl("influxdb://token:t@localhost:8086/metrics")).not.toThrow();
  expect(() => parseConnectionUrl("d1://acc:token@api.cloudflare.com/shop")).not.toThrow();
  expect(connectionSummary("d1://acc:token@api.cloudflare.com/shop")).toMatchObject({
    host: "api.cloudflare.com",
    database: "shop",
    user: "acc",
  });
  expect(() => parseConnectionUrl("mongodb://x", "elasticsearch")).toThrow();
});

test("filter builder emits dialects the HTTP adapters translate", () => {
  expect(compileSingleCondition("user.name", "contains", "a%b", "elasticsearch")).toBe(
    `"user.name" LIKE '%a!%b%' ESCAPE '!'`,
  );
  expect(compileSingleCondition("host", "startsWith", "web", "influxdb")).toBe(
    `CAST("host" AS VARCHAR) ILIKE 'web%' ESCAPE '\\'`,
  );
  expect(compileSingleCondition("host", "contains", "a_b", "influxdb")).toBe(
    `CAST("host" AS VARCHAR) ILIKE '%a\\_b%' ESCAPE '\\'`,
  );
  expect(compileSingleCondition("name", "endsWith", "x", "sqlite_http")).toBe(
    `CAST("name" AS TEXT) LIKE '%x' ESCAPE '!'`,
  );
});
