import { describe, expect, test } from "bun:test";
import { buildExternalCandidates, endpointKey } from "../src/lib/connection-import";
import {
  type ExternalConnection,
  emptyExternalConnection,
} from "../src/lib/connection-import/types";
import type { SavedConnection } from "../src/lib/connections";
import type { DatabaseKind, SslMode } from "../src/lib/db";

interface Spec {
  kind: DatabaseKind;
  cite: string;
  scheme: string;
  tlsScheme: string;
  port: number;
  fieldTlsPort: number;
  httpsUrlPort: number | null;
  implicitTlsPort: number;
  writer: "sslmode" | "secure" | "ssl" | "mongo" | "scheme";
  insecure: string | null;
  flagMode: SslMode;
  database: string;
  identity: string;
}

const SPECS: Spec[] = [
  {
    kind: "postgres",
    cite: "connection.rs:104",
    scheme: "postgresql",
    tlsScheme: "postgresql",
    port: 5432,
    fieldTlsPort: 5432,
    httpsUrlPort: null,
    implicitTlsPort: 5432,
    writer: "sslmode",
    insecure: null,
    flagMode: "verify-full",
    database: "app",
    identity: "options=",
  },
  {
    kind: "mysql",
    cite: "mysql.rs:394",
    scheme: "mysql",
    tlsScheme: "mysql",
    port: 3306,
    fieldTlsPort: 3306,
    httpsUrlPort: null,
    implicitTlsPort: 3306,
    writer: "sslmode",
    insecure: null,
    flagMode: "require",
    database: "app",
    identity: "",
  },
  {
    kind: "mssql",
    cite: "mssql.rs:508",
    scheme: "mssql",
    tlsScheme: "mssql",
    port: 1433,
    fieldTlsPort: 1433,
    httpsUrlPort: null,
    implicitTlsPort: 1433,
    writer: "sslmode",
    insecure: null,
    flagMode: "verify-full",
    database: "app",
    identity: "instance=",
  },
  {
    kind: "cassandra",
    cite: "cassandra.rs:285",
    scheme: "cassandra",
    tlsScheme: "cassandra",
    port: 9042,
    fieldTlsPort: 9042,
    httpsUrlPort: null,
    implicitTlsPort: 9042,
    writer: "sslmode",
    insecure: null,
    flagMode: "require",
    database: "app",
    identity: "",
  },
  {
    kind: "clickhouse",
    cite: "clickhouse.rs:75+82",
    scheme: "clickhouse",
    tlsScheme: "clickhouse",
    port: 8123,
    fieldTlsPort: 8443,
    httpsUrlPort: 8443,
    implicitTlsPort: 8443,
    writer: "secure",
    insecure: null,
    flagMode: "verify-full",
    database: "app",
    identity: "",
  },
  {
    kind: "elasticsearch",
    cite: "http_api.rs:115+119, elasticsearch.rs:384",
    scheme: "elasticsearch",
    tlsScheme: "elasticsearch",
    port: 9200,
    fieldTlsPort: 9200,
    httpsUrlPort: null,
    implicitTlsPort: 443,
    writer: "ssl",
    insecure: "insecure=true",
    flagMode: "verify-full",
    database: "app",
    identity: "",
  },
  {
    kind: "influxdb",
    cite: "http_api.rs:115+119, influxdb.rs:402",
    scheme: "influxdb",
    tlsScheme: "influxdb",
    port: 8086,
    fieldTlsPort: 8086,
    httpsUrlPort: null,
    implicitTlsPort: 443,
    writer: "ssl",
    insecure: "insecure=true",
    flagMode: "verify-full",
    database: "app",
    identity: "org=",
  },
  {
    kind: "mongodb",
    cite: "mongodb.rs:126",
    scheme: "mongodb",
    tlsScheme: "mongodb",
    port: 27017,
    fieldTlsPort: 27017,
    httpsUrlPort: null,
    implicitTlsPort: 27017,
    writer: "mongo",
    insecure: "tlsAllowInvalidCertificates=true",
    flagMode: "verify-full",
    database: "app",
    identity: "replicaSet=,authSource=",
  },
  {
    kind: "redis",
    cite: "redis.rs:155",
    scheme: "redis",
    tlsScheme: "rediss",
    port: 6379,
    fieldTlsPort: 6379,
    httpsUrlPort: null,
    implicitTlsPort: 6379,
    writer: "scheme",
    insecure: null,
    flagMode: "verify-full",
    database: "0",
    identity: "",
  },
];

type Signal = "none" | "url" | "param" | "sslMode" | "handler";

const SIGNALS: Signal[] = ["none", "url", "param", "sslMode", "handler"];

const JUMP = {
  host: "jump",
  port: 22,
  user: "ops",
  auth: "agent" as const,
  keyFile: "",
  secret: null,
};

function source(
  spec: Spec,
  signal: Signal,
  port: number | null,
  verifyOff: boolean,
): ExternalConnection {
  const connection = emptyExternalConnection("s", "row");
  connection.kind = spec.kind;
  connection.host = "db.example.com";
  connection.port = port;
  connection.user = "u";
  connection.database = spec.database;
  connection.ssh = { ...JUMP };
  if (signal === "url") {
    connection.urlScheme = "https";
    if (verifyOff) connection.params.push(["skip_verify", "true"]);
  }
  if (signal === "param") {
    connection.params.push(["ssl", "true"]);
    if (verifyOff) connection.params.push(["verify_ssl", "false"]);
  }
  if (signal === "sslMode")
    connection.params.push(["sslmode", verifyOff ? "require" : "verify-full"]);
  if (signal === "handler") connection.sslMode = verifyOff ? "require" : "verify-full";
  return connection;
}

function expected(spec: Spec, signal: Signal, port: number | null, verifyOff: boolean) {
  const tls = signal !== "none";
  const fromFlag = signal === "url" || signal === "param";
  const mode: SslMode = !tls
    ? "prefer"
    : verifyOff || (fromFlag && spec.flagMode === "require")
      ? "require"
      : "verify-full";
  const query: string[] = [];
  if (spec.writer === "sslmode") query.push(`sslmode=${mode}`);
  if (tls && spec.writer === "secure") query.push("secure=1");
  if (tls && spec.writer === "ssl") query.push("ssl=true");
  if (tls && spec.writer === "mongo") query.push("tls=true");
  if (tls && mode === "require" && spec.insecure) query.push(spec.insecure);
  const urlPort =
    port ?? (signal === "url" ? spec.httpsUrlPort : tls ? spec.fieldTlsPort : spec.port);
  const remote = urlPort ?? spec.implicitTlsPort;
  const scheme = tls && spec.writer === "scheme" ? spec.tlsScheme : spec.scheme;
  const url = `${scheme}://u@db.example.com${urlPort ? `:${urlPort}` : ""}/${spec.database}${query.length ? `?${query.join("&")}` : ""}`;
  const key = [
    scheme,
    "db.example.com",
    String(remote),
    spec.database,
    "u",
    "ssh:jump:22:ops",
    spec.identity,
  ].join("|");
  return { url, remote, key, mode };
}

describe("transport matrix", () => {
  for (const spec of SPECS)
    for (const signal of SIGNALS)
      for (const port of [null, 4100])
        for (const verifyOff of [false, true]) {
          if (signal === "none" && verifyOff) continue;
          test(`${spec.kind} (${spec.cite}) tls=${signal} port=${port ?? "none"} verify=${verifyOff ? "off" : "on"}`, () => {
            const [candidate] = buildExternalCandidates(
              [source(spec, signal, port, verifyOff)],
              [],
            );
            const want = expected(spec, signal, port, verifyOff);
            expect(candidate.skipReason).toBeNull();
            expect(candidate.profile?.connectionString).toBe(want.url);
            expect(candidate.profile?.ssh?.remotePort).toBe(want.remote);
            expect(candidate.endpoint).toBe(want.key);
            expect(candidate.profile?.sslMode).toBe(want.mode);
          });
        }
});

interface Scenario {
  name: string;
  kind: DatabaseKind;
  host?: string;
  port?: number | null;
  database?: string;
  params?: Array<[string, string]>;
  sslMode?: SslMode | null;
  urlScheme?: "http" | "https" | null;
  user?: string;
  password?: string | null;
  url: string;
  remote?: number;
  warning?: string;
}

const SCENARIOS: Scenario[] = [
  {
    name: "round 4 B1: cassandra ssl=true is not overridden by sslmode=prefer (cassandra.rs:285+289)",
    kind: "cassandra",
    params: [
      ["ssl", "true"],
      ["sslmode", "prefer"],
    ],
    url: "cassandra://u@db:9042/app?sslmode=require",
  },
  {
    name: "round 4 B1: cassandra tls=true keeps TLS (cassandra.rs:289)",
    kind: "cassandra",
    params: [["tls", "1"]],
    url: "cassandra://u@db:9042/app?sslmode=require",
  },
  {
    name: "round 4 B3: redis ssl=true becomes rediss and drops the raw param (redis.rs:155)",
    kind: "redis",
    database: "0",
    params: [["ssl", "true"]],
    url: "rediss://u@db:6379/0",
  },
  {
    name: "round 4 B3: redis tls=true becomes rediss (redis.rs:155)",
    kind: "redis",
    database: "0",
    params: [["tls", "true"]],
    url: "rediss://u@db:6379/0",
  },
  {
    name: "round 4 B5: mongo keeps verification-off with an existing tls param (mongodb.rs:126)",
    kind: "mongodb",
    params: [["tls", "true"]],
    sslMode: "require",
    url: "mongodb://u@db:27017/app?tls=true&tlsAllowInvalidCertificates=true",
  },
  {
    name: "round 4 B4: elasticsearch field without port and TLS handler uses 9200",
    kind: "elasticsearch",
    sslMode: "verify-full",
    url: "elasticsearch://u@db:9200/app?ssl=true",
    remote: 9200,
  },
  {
    name: "round 4 B4: elasticsearch https URL without port means 443 (elasticsearch.rs:384)",
    kind: "elasticsearch",
    urlScheme: "https",
    url: "elasticsearch://u@db/app?ssl=true",
    remote: 443,
  },
  {
    name: "round 4 B4: influxdb field without port and TLS uses 8086 (influxdb.rs:402)",
    kind: "influxdb",
    params: [["ssl", "true"]],
    url: "influxdb://u@db:8086/app?ssl=true",
    remote: 8086,
  },
  {
    name: "round 3: clickhouse https URL without port uses 8443 (clickhouse.rs:82)",
    kind: "clickhouse",
    urlScheme: "https",
    url: "clickhouse://u@db:8443/app?secure=1",
    remote: 8443,
  },
  {
    name: "round 3: clickhouse verification off only warns (clickhouse.rs:75)",
    kind: "clickhouse",
    urlScheme: "https",
    port: 9440,
    params: [["skip_verify", "true"]],
    url: "clickhouse://u@db:9440/app?secure=1",
    warning: "Zertifikatsprüfung war in der Quelle aus",
  },
  {
    name: "round 2 a: pgjdbc ssl=true means verify-full (connection.rs:104)",
    kind: "postgres",
    params: [["ssl", "true"]],
    url: "postgresql://u@db:5432/app?sslmode=verify-full",
  },
  {
    name: "round 2 a: pgjdbc NonValidatingFactory means require",
    kind: "postgres",
    params: [
      ["ssl", "true"],
      ["sslfactory", "org.postgresql.ssl.NonValidatingFactory"],
    ],
    url: "postgresql://u@db:5432/app?sslmode=require",
  },
  {
    name: "round 2 a: explicit sslmode wins over ssl=true",
    kind: "postgres",
    params: [
      ["ssl", "true"],
      ["sslmode", "verify-ca"],
    ],
    url: "postgresql://u@db:5432/app?sslmode=verify-ca",
  },
  {
    name: "round 2 a: ssl=false disables TLS",
    kind: "postgres",
    params: [["ssl", "false"]],
    url: "postgresql://u@db:5432/app?sslmode=disable",
  },
  {
    name: "round 2 a: mysql sslMode=REQUIRED (mysql.rs:398)",
    kind: "mysql",
    params: [["sslMode", "REQUIRED"]],
    url: "mysql://u@db:3306/app?sslmode=require",
  },
  {
    name: "round 2 a: mysql useSSL with server verification is verify-ca (mysql.rs:410)",
    kind: "mysql",
    params: [
      ["useSSL", "true"],
      ["verifyServerCertificate", "true"],
    ],
    url: "mysql://u@db:3306/app?sslmode=verify-ca",
  },
  {
    name: "round 2 2: mssql encrypt with trusted certificate is require and renames instance (mssql.rs:512+534)",
    kind: "mssql",
    params: [
      ["instanceName", "SQLEXPRESS"],
      ["encrypt", "true"],
      ["trustServerCertificate", "true"],
      ["integratedSecurity", "true"],
    ],
    url: "mssql://u@db:1433/app?instance=SQLEXPRESS&integrated_security=true&sslmode=require",
  },
  {
    name: "round 2 2: mssql encrypt=optional stays prefer",
    kind: "mssql",
    params: [["encrypt", "optional"]],
    url: "mssql://u@db:1433/app?sslmode=prefer",
  },
  {
    name: "round 2 e: redis password without user keeps an empty user",
    kind: "redis",
    database: "0",
    user: "",
    password: "pw",
    url: "redis://@db:6379/0",
  },
  {
    name: "round 1: secret-like params are stripped",
    kind: "mysql",
    params: [
      ["keyStorePassword", "x"],
      ["useUnicode", "true"],
    ],
    url: "mysql://u@db:3306/app?useUnicode=true&sslmode=prefer",
  },
];

describe("review scenarios", () => {
  for (const scenario of SCENARIOS)
    test(scenario.name, () => {
      const connection = emptyExternalConnection("s", scenario.name);
      connection.kind = scenario.kind;
      connection.host = scenario.host ?? "db";
      connection.port = scenario.port ?? null;
      connection.user = scenario.user ?? "u";
      connection.password = scenario.password ?? null;
      connection.database = scenario.database ?? "app";
      connection.params = scenario.params ?? [];
      connection.sslMode = scenario.sslMode ?? null;
      connection.urlScheme = scenario.urlScheme ?? null;
      connection.ssh = { ...JUMP };
      const [candidate] = buildExternalCandidates([connection], []);
      expect(candidate.profile?.connectionString).toBe(scenario.url);
      if (scenario.remote !== undefined) {
        expect(candidate.profile?.ssh?.remotePort).toBe(scenario.remote);
        expect(candidate.endpoint.split("|")[2]).toBe(String(scenario.remote));
      }
      if (scenario.warning) expect(candidate.warnings.join(" ")).toContain(scenario.warning);
    });
});

function cloud(kind: DatabaseKind, fields: Partial<ExternalConnection>): ExternalConnection {
  return { ...emptyExternalConnection("c", "cloud"), kind, ...fields };
}

describe("DynamoDB endpoints (aws.rs:90)", () => {
  const rows: Array<[string, Partial<ExternalConnection>, string]> = [
    [
      "localhost",
      { host: "localhost", port: 8000 },
      "dynamodb://local@us-east-1?endpoint=http%3A%2F%2Flocalhost%3A8000",
    ],
    [
      "127.0.0.1 keeps a configured region",
      { host: "127.0.0.1", port: 8000, params: [["region", "eu-west-1"]] },
      "dynamodb://local@eu-west-1?endpoint=http%3A%2F%2F127.0.0.1%3A8000",
    ],
    [
      "::1",
      { host: "::1", port: 8000 },
      "dynamodb://local@us-east-1?endpoint=http%3A%2F%2F%5B%3A%3A1%5D%3A8000",
    ],
    [
      ".local host",
      { host: "dynamo.local", port: 4566 },
      "dynamodb://local@us-east-1?endpoint=http%3A%2F%2Fdynamo.local%3A4566",
    ],
    [
      "non-AWS host with region",
      { host: "ddb.internal", params: [["AwsRegion", "eu-central-1"]] },
      "dynamodb://local@eu-central-1?endpoint=http%3A%2F%2Fddb.internal%3A8000",
    ],
    [
      "https local",
      { host: "localhost", port: 4566, urlScheme: "https" },
      "dynamodb://local@us-east-1?endpoint=https%3A%2F%2Flocalhost%3A4566",
    ],
    [
      "real AWS host",
      { host: "dynamodb.eu-west-1.amazonaws.com", params: [["profile", "prod"]] },
      "dynamodb://eu-west-1?profile=prod",
    ],
    [
      "real AWS without host",
      {
        params: [
          ["region", "us-west-2"],
          ["profile", "dev"],
        ],
      },
      "dynamodb://us-west-2?profile=dev",
    ],
  ];
  for (const [name, fields, url] of rows)
    test(name, () => {
      const [candidate] = buildExternalCandidates([cloud("dynamodb", fields)], []);
      expect(candidate.profile?.connectionString).toBe(url);
    });
});

describe("cloud duplicate identity (B6)", () => {
  const rows: Array<[DatabaseKind, string, string]> = [
    [
      "snowflake",
      "snowflake://U@acme/DB/S?warehouse=WH&role=R",
      "snowflake://U@acme/DB/S?warehouse=OTHER&role=R",
    ],
    [
      "snowflake",
      "snowflake://U@acme/DB/S?warehouse=WH&role=R",
      "snowflake://U@acme/DB/S?warehouse=WH&role=ADMIN",
    ],
    [
      "athena",
      "athena://eu-central-1/AwsDataCatalog?schema=web&output=s3%3A%2F%2Fa%2F",
      "athena://eu-central-1/AwsDataCatalog?schema=etl&output=s3%3A%2F%2Fa%2F",
    ],
    [
      "athena",
      "athena://eu-central-1/AwsDataCatalog?output=s3%3A%2F%2Fa%2F",
      "athena://eu-central-1/AwsDataCatalog?output=s3%3A%2F%2Fb%2F",
    ],
    [
      "athena",
      "athena://eu-central-1/AwsDataCatalog?workgroup=a",
      "athena://eu-central-1/AwsDataCatalog?workgroup=b",
    ],
    ["athena", "athena://eu-central-1/AwsDataCatalog", "athena://eu-central-1/OtherCatalog"],
    ["bigquery", "bigquery://p/d?location=EU", "bigquery://p/d?location=US"],
    [
      "bigquery",
      "bigquery://p/d?credentials_file=%2Fa.json",
      "bigquery://p/d?credentials_file=%2Fb.json",
    ],
    ["dynamodb", "dynamodb://eu-west-1?profile=a", "dynamodb://eu-west-1?profile=b"],
    [
      "dynamodb",
      "dynamodb://eu-west-1",
      "dynamodb://eu-west-1?endpoint=http%3A%2F%2Flocalhost%3A8000",
    ],
  ];
  for (const [kind, left, right] of rows)
    test(`${kind}: ${left} differs from ${right}`, () => {
      expect(endpointKey(kind, left)).not.toBe(endpointKey(kind, right));
      expect(endpointKey(kind, left)).toBe(endpointKey(kind, left));
    });

  test("an imported Snowflake connection matches an existing one with the same identity", () => {
    const existing: SavedConnection = {
      id: "e1",
      name: "e",
      kind: "snowflake",
      connectionString: "snowflake://ANNA@acme/SALES?warehouse=WH&role=R",
      sslMode: "prefer",
    };
    const imported = cloud("snowflake", {
      host: "acme.snowflakecomputing.com",
      user: "ANNA",
      database: "SALES",
      params: [
        ["warehouse", "WH"],
        ["role", "R"],
      ],
    });
    const [same] = buildExternalCandidates([imported], [existing]);
    expect(same.duplicateOf?.id).toBe("e1");
    const [other] = buildExternalCandidates(
      [
        {
          ...imported,
          params: [
            ["warehouse", "OTHER"],
            ["role", "R"],
          ],
        },
      ],
      [existing],
    );
    expect(other.duplicateOf).toBeNull();
  });
});

test("existing URLs without a port resolve to the adapter default in the duplicate key", () => {
  expect(endpointKey("elasticsearch", "elasticsearch://u@db/app?ssl=true")?.split("|")[2]).toBe(
    "443",
  );
  expect(endpointKey("elasticsearch", "elasticsearch://u@db/app")?.split("|")[2]).toBe("9200");
  expect(endpointKey("clickhouse", "clickhouse://u@db/app?secure=1")?.split("|")[2]).toBe("8443");
  expect(endpointKey("redis", "rediss://db/0")).not.toBe(endpointKey("redis", "redis://db/0"));
  expect(endpointKey("postgres", "postgres://u@db/app")).toBe(
    endpointKey("postgres", "postgresql://u@db:5432/app?sslmode=prefer"),
  );
});
