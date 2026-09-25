import { describe, expect, mock, test } from "bun:test";

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
    capabilities: {
      ssl: false,
      ssh: false,
      views: true,
      read_only_mode: false,
      proxy_user: kind === "snowflake",
      query_cancel: kind === "snowflake" || kind === "bigquery",
    },
    driver_status: { available: true, detail: "", install: [] },
  };
}

const PROVIDERS = [
  provider("postgres", "postgres", ["postgresql", "postgres"], ["localhost"]),
  provider("bigquery", "bigquery", ["bigquery"], []),
  provider("snowflake", "snowflake", ["snowflake"], [".snowflakecomputing.com"]),
  provider("snowflake-odbc", "odbc", ["odbc"], []),
];

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    if (command === "list_providers") return PROVIDERS;
    return null;
  },
}));

const { loadProviders } = await import("../src/lib/providers");
await loadProviders();
const {
  detectProvider,
  joinKeySecret,
  kindFromUrl,
  parseConnectionUrl,
  searchParam,
  splitKeySecret,
  withSearchParam,
} = await import("../src/lib/connection-url");
const { extractUrlPassword, injectUrlPassword, scrubUrlPassword } = await import(
  "../src/lib/secrets"
);
const { effectiveConnectionString } = await import("../src/lib/ssh");
const { quoteIdent, quoteLike, quoteString, textMatch } = await import(
  "../src/lib/sql-filter/quote"
);
const { sqlDialectForKind } = await import("../src/lib/sql-format");

const PEM =
  "-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIB+/abc=\n-----END ENCRYPTED PRIVATE KEY-----";

describe("Warehouse-URLs", () => {
  test("bigquery and snowflake schemes resolve to native families", () => {
    expect(kindFromUrl("bigquery://my-project/sales?location=EU")).toBe("bigquery");
    expect(kindFromUrl("snowflake://svc@myorg-acct/DB?warehouse=WH")).toBe("snowflake");
    expect(detectProvider("snowflake://svc@xy12345.eu-central-1.snowflakecomputing.com/DB")).toBe(
      "snowflake",
    );
    expect(parseConnectionUrl("bigquery://my-project/sales").hostname).toBe("my-project");
    expect(() => parseConnectionUrl("bigquery:///sales", "bigquery")).toThrow("Host");
  });

  test("service account json and pem keys round-trip through the keychain slot", () => {
    const json = JSON.stringify({ type: "service_account", private_key: PEM });
    const url = `bigquery://service_account:${encodeURIComponent(json)}@proj/ds`;
    expect(extractUrlPassword(url)).toBe(json);
    const scrubbed = scrubUrlPassword(url);
    expect(scrubbed).toBe("bigquery://service_account@proj/ds");
    expect(injectUrlPassword(scrubbed, json)).toBe(url);
    const secret = joinKeySecret(PEM, "geheim");
    const snowflake = injectUrlPassword("snowflake://svc@acct/DB?warehouse=WH", secret);
    expect(extractUrlPassword(snowflake)).toBe(secret);
    expect(splitKeySecret(extractUrlPassword(snowflake) ?? "")).toEqual({
      pem: PEM,
      passphrase: "geheim",
    });
  });

  test("key secret helpers keep typing intact", () => {
    expect(joinKeySecret("-----BEGIN X-----\n", "")).toBe("-----BEGIN X-----\n");
    expect(joinKeySecret("-----BEGIN X-----\nab", "pw")).toBe("-----BEGIN X-----\nab");
    expect(joinKeySecret(`${PEM}\n\n`, "pw")).toBe(`${PEM}\npw`);
    expect(splitKeySecret("pat-token")).toEqual({ pem: "pat-token", passphrase: "" });
    expect(splitKeySecret(`${PEM}\n`)).toEqual({ pem: PEM, passphrase: "" });
  });

  test("search param helpers edit connection options", () => {
    let search = withSearchParam("", "warehouse", "COMPUTE WH");
    expect(search).toBe("?warehouse=COMPUTE%20WH");
    search = withSearchParam(search, "role", "ANALYST");
    expect(searchParam(search, "warehouse")).toBe("COMPUTE WH");
    expect(withSearchParam(withSearchParam(search, "role", ""), "warehouse", "")).toBe("");
  });

  test("snowflake role quick switch travels as proxy_user", () => {
    const connection = {
      id: "sf",
      name: "Snowflake",
      kind: "snowflake" as const,
      connectionString: "snowflake://svc:pat@acct/DB?warehouse=WH&role=ANALYST",
      proxyUser: "SYSADMIN",
    };
    const url = new URL(effectiveConnectionString(connection));
    expect(url.searchParams.get("proxy_user")).toBe("SYSADMIN");
    expect(url.searchParams.get("role")).toBe("ANALYST");
    const bigquery = {
      id: "bq",
      name: "BigQuery",
      kind: "bigquery" as const,
      connectionString: "bigquery://proj/ds",
      proxyUser: "x",
    };
    expect(effectiveConnectionString(bigquery)).toBe("bigquery://proj/ds");
  });
});

describe("Warehouse-SQL-Dialekte", () => {
  test("bigquery quotes identifiers with backticks per path segment", () => {
    expect(quoteIdent("info.city", "bigquery")).toBe("`info`.`city`");
    expect(quoteString("it's \\ ok", "bigquery")).toBe("'it\\'s \\\\ ok'");
    expect(textMatch("`name`", `%${quoteLike("50%_", "bigquery")}%`, "bigquery")).toBe(
      "LOWER(CAST(`name` AS STRING)) LIKE LOWER('%50\\\\%\\\\_%')",
    );
    expect(sqlDialectForKind("bigquery")).toBe("bigquery");
  });

  test("snowflake escapes backslashes and uses ILIKE", () => {
    expect(quoteIdent("Order", "snowflake")).toBe('"Order"');
    expect(quoteString("a\\b'c", "snowflake")).toBe("'a\\\\b''c'");
    expect(textMatch('"NAME"', "%x%", "snowflake")).toBe(
      "CAST(\"NAME\" AS VARCHAR) ILIKE '%x%' ESCAPE '!'",
    );
    expect(sqlDialectForKind("snowflake")).toBe("snowflake");
  });
});
