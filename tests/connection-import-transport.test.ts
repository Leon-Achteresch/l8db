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
  tlsInKey: boolean;
  flagParam: string;
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
    identity: "options=,hostaddr=",
    tlsInKey: false,
    flagParam: "ssl",
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
    tlsInKey: false,
    flagParam: "useSSL",
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
    tlsInKey: false,
    flagParam: "encrypt",
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
    identity: "nodes=",
    tlsInKey: false,
    flagParam: "ssl",
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
    tlsInKey: true,
    flagParam: "secure",
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
    tlsInKey: true,
    flagParam: "tls",
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
    identity: "org=,db=,version=",
    tlsInKey: true,
    flagParam: "ssl",
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
    tlsInKey: false,
    flagParam: "tls",
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
    tlsInKey: true,
    flagParam: "ssl",
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
    connection.portFromUrl = true;
    if (verifyOff) connection.params.push(["skip_verify", "true"]);
  }
  if (signal === "param") {
    connection.params.push([spec.flagParam, "true"]);
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
    `${spec.kind}${spec.tlsInKey && tls ? "+tls" : ""}`,
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
      connection.portFromUrl = scenario.urlScheme != null;
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
      "dynamodb://eu-central-1?endpoint=http%3A%2F%2Fddb.internal",
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

async function dbeaverRow(
  provider: string,
  driver: string,
  configuration: Record<string, unknown>,
) {
  const { parseDbeaverConfig } = await import("../src/lib/connection-import");
  const parsed = await parseDbeaverConfig(
    JSON.stringify({ connections: { one: { provider, driver, name: "one", configuration } } }),
    null,
  );
  return buildExternalCandidates(parsed.connections, [])[0];
}

describe("finding 1: DBeaver entries with host still read TLS from the url field", () => {
  const rows: Array<[string, Record<string, unknown>, string, number]> = [
    [
      "elasticsearch host + https url, empty port uses the tool default 9200",
      { host: "es", user: "u", url: "jdbc:es://https://es" },
      "elasticsearch://u@es:9200?ssl=true",
      9200,
    ],
    [
      "elasticsearch host + http url stays plain",
      { host: "es", user: "u", url: "jdbc:es://http://es" },
      "elasticsearch://u@es:9200?ssl=false",
      9200,
    ],
    [
      "clickhouse host + https url uses the TLS field default 8443",
      { host: "ch", user: "u", database: "db", url: "jdbc:clickhouse:https://ch/db" },
      "clickhouse://u@ch:8443/db?secure=1",
      8443,
    ],
    [
      "clickhouse host + http url stays on 8123",
      { host: "ch", user: "u", database: "db", url: "jdbc:clickhouse:http://ch/db" },
      "clickhouse://u@ch:8123/db?secure=0",
      8123,
    ],
  ];
  for (const [name, configuration, url, remote] of rows)
    test(name, async () => {
      const provider = String(configuration.url).includes("clickhouse")
        ? "clickhouse"
        : "elasticsearch";
      const candidate = await dbeaverRow(provider, provider, {
        ...configuration,
        handlers: {
          ssh_tunnel: { type: "TUNNEL", enabled: true, properties: { host: "jump", user: "ops" } },
        },
      });
      expect(candidate.profile?.connectionString).toBe(url);
      expect(candidate.profile?.ssh?.remotePort).toBe(remote);
      expect(candidate.endpoint.split("|")[2]).toBe(String(remote));
    });
});

describe("finding 2 + 7: DynamoDB custom endpoints keep credentials (aws.rs:66-90)", () => {
  const rows: Array<[string, Partial<ExternalConnection>, string, string | null]> = [
    [
      "VPC endpoint on amazonaws.com keeps profile",
      { host: "vpce-1.dynamodb.eu-west-1.vpce.amazonaws.com", params: [["profile", "prod"]] },
      "dynamodb://eu-west-1?profile=prod&endpoint=https%3A%2F%2Fvpce-1.dynamodb.eu-west-1.vpce.amazonaws.com",
      null,
    ],
    [
      "China region host is standard AWS",
      { host: "dynamodb.cn-north-1.amazonaws.com.cn", params: [["profile", "cn"]] },
      "dynamodb://cn-north-1?profile=cn",
      null,
    ],
    [
      "dual-stack api.aws host is standard AWS",
      { host: "dynamodb.eu-central-1.api.aws", params: [["profile", "p"]] },
      "dynamodb://eu-central-1?profile=p",
      null,
    ],
    [
      "https custom host keeps credentials and omits the port (443)",
      {
        host: "ddb.example.com",
        urlScheme: "https",
        user: "AKIA",
        password: "s",
        params: [["region", "eu-west-1"]],
      },
      "dynamodb://AKIA@eu-west-1?endpoint=https%3A%2F%2Fddb.example.com",
      "s",
    ],
    [
      "non-AWS host on port 8000 keeps source credentials",
      { host: "ddb.lan", port: 8000, user: "AKIA", password: "s" },
      "dynamodb://AKIA@us-east-1?endpoint=http%3A%2F%2Fddb.lan%3A8000",
      "s",
    ],
    [
      "non-AWS http host without port does not get 8000",
      { host: "ddb.lan", params: [["profile", "x"]] },
      "dynamodb://us-east-1?profile=x&endpoint=http%3A%2F%2Fddb.lan",
      null,
    ],
    [
      "loopback without credentials gets local defaults",
      { host: "127.0.0.1" },
      "dynamodb://local@us-east-1?endpoint=http%3A%2F%2F127.0.0.1%3A8000",
      "local",
    ],
    [
      "loopback with credentials keeps them",
      { host: "localhost", port: 4566, user: "test", password: "pw" },
      "dynamodb://test@us-east-1?endpoint=http%3A%2F%2Flocalhost%3A4566",
      "pw",
    ],
    [
      "https loopback without port uses 443",
      { host: "localhost", urlScheme: "https" },
      "dynamodb://local@us-east-1?endpoint=https%3A%2F%2Flocalhost",
      "local",
    ],
  ];
  for (const [name, fields, url, password] of rows)
    test(name, () => {
      const [candidate] = buildExternalCandidates([cloud("dynamodb", fields)], []);
      expect(candidate.profile?.connectionString).toBe(url);
      expect(candidate.password).toBe(password);
    });

  test("non-loopback custom endpoints warn about a defaulted region", () => {
    const [candidate] = buildExternalCandidates(
      [cloud("dynamodb", { host: "ddb.lan", port: 8000, user: "A", password: "s" })],
      [],
    );
    expect(candidate.warnings.join(" ")).toContain("Region prüfen");
  });
});

describe("finding 3 + 6: duplicate keys use the canonical kind (provider.rs:449-457)", () => {
  const same: Array<[DatabaseKind, string, string]> = [
    ["clickhouse", "https://u@ch/db", "clickhouse://u@ch:8443/db?secure=1"],
    ["clickhouse", "http://u@ch/db", "clickhouse://u@ch:8123/db"],
    ["elasticsearch", "opensearch://u@os:9200", "elasticsearch://u@os:9200"],
    ["elasticsearch", "https://u@es", "elasticsearch://u@es:443?ssl=true"],
    ["influxdb", "http://token@i:8086/b", "influxdb://token@i/b"],
    ["redis", "valkey://db:6379/0", "redis://db/0"],
    ["postgres", "postgres://u@db/app", "postgresql://u@db:5432/app?sslmode=prefer"],
  ];
  for (const [kind, left, right] of same)
    test(`${kind}: ${left} equals ${right}`, () => {
      expect(endpointKey(kind, left)).toBe(endpointKey(kind, right));
    });
  const different: Array<[DatabaseKind, string, string]> = [
    ["clickhouse", "https://u@ch:8443/db", "http://u@ch:8443/db"],
    ["redis", "rediss://db:6379/0", "redis://db:6379/0"],
    ["mongodb", "mongodb+srv://u@cluster.example.com/app", "mongodb://u@cluster.example.com/app"],
  ];
  for (const [kind, left, right] of different)
    test(`${kind}: ${left} differs from ${right}`, () => {
      expect(endpointKey(kind, left)).not.toBe(endpointKey(kind, right));
    });
  test("mongodb+srv keys carry no default port", () => {
    expect(endpointKey("mongodb", "mongodb+srv://u@cluster.example.com/app")?.split("|")[2]).toBe(
      "",
    );
  });
});

describe("finding 4: identity params follow the adapter URL reads", () => {
  const rows: Array<[DatabaseKind, string, string, string]> = [
    [
      "snowflake",
      "snowflake.rs:336",
      "snowflake://U@acme?database=A",
      "snowflake://U@acme?database=B",
    ],
    ["snowflake", "snowflake.rs:336", "snowflake://U@acme?db=A", "snowflake://U@acme?db=B"],
    [
      "snowflake",
      "snowflake.rs:337",
      "snowflake://U@acme/DB?schema=A",
      "snowflake://U@acme/DB?schema=B",
    ],
    [
      "snowflake",
      "snowflake.rs:341",
      "snowflake://U@acme?endpoint=https%3A%2F%2Fa",
      "snowflake://U@acme?endpoint=https%3A%2F%2Fb",
    ],
    ["bigquery", "bigquery.rs:309", "bigquery://p?project=a", "bigquery://p?project=b"],
    ["bigquery", "bigquery.rs:311", "bigquery://p?endpoint=a", "bigquery://p?api_endpoint=b"],
    ["bigquery", "bigquery.rs:312", "bigquery://p?key_file=a", "bigquery://p?credentials_file=b"],
    ["influxdb", "influxdb.rs:425", "influxdb://h/b?org=a", "influxdb://h/b?orgID=b"],
    ["influxdb", "influxdb.rs:409", "influxdb://h?bucket=a", "influxdb://h?db=b"],
    ["influxdb", "influxdb.rs:411", "influxdb://h/b?version=2", "influxdb://h/b?version=3"],
    ["cassandra", "cassandra.rs:278", "cassandra://h/ks?nodes=a", "cassandra://h/ks?hosts=b"],
    ["mssql", "mssql.rs:534", "mssql://u@h/db?instance=A", "mssql://u@h/db?instance=B"],
    [
      "postgres",
      "connection.rs:286",
      "postgresql://u@h/db?hostaddr=10.0.0.1",
      "postgresql://u@h/db?hostaddr=10.0.0.2",
    ],
    ["oracle", "oracle.rs:895", "oracle://u@h/?connect_string=A", "oracle://u@h/?tns=B"],
    ["athena", "athena.rs:222", "athena://r/C?schema=a", "athena://r/C?schema=b"],
    ["dynamodb", "aws.rs:81", "dynamodb://r?profile=a", "dynamodb://r?profile=b"],
  ];
  for (const [kind, cite, left, right] of rows)
    test(`${kind} (${cite}): ${left} differs from ${right}`, () => {
      expect(endpointKey(kind, left)).not.toBe(endpointKey(kind, right));
    });
  test("aliases resolve to the same identity", () => {
    expect(endpointKey("snowflake", "snowflake://U@acme?db=A")).toBe(
      endpointKey("snowflake", "snowflake://U@acme?database=A"),
    );
    expect(endpointKey("influxdb", "influxdb://h/b?orgID=x")).toBe(
      endpointKey("influxdb", "influxdb://h/b?org=x"),
    );
  });
});

describe("finding 5: per-driver precedence from the adapter table (mysql.rs:408)", () => {
  const rows: Array<[string, Array<[string, string]>, string]> = [
    [
      "useSSL=false overrides requireSSL=true",
      [
        ["requireSSL", "true"],
        ["useSSL", "false"],
      ],
      "disable",
    ],
    [
      "useSSL=true with requireSSL=false still uses TLS",
      [
        ["useSSL", "true"],
        ["requireSSL", "false"],
      ],
      "require",
    ],
    ["requireSSL alone enables TLS", [["requireSSL", "true"]], "require"],
    [
      "sslMode beats useSSL",
      [
        ["useSSL", "false"],
        ["sslMode", "VERIFY_IDENTITY"],
      ],
      "verify-full",
    ],
  ];
  for (const [name, params, mode] of rows)
    test(name, () => {
      const connection = emptyExternalConnection("p", name);
      connection.kind = "mysql";
      connection.host = "db";
      connection.user = "u";
      connection.database = "app";
      connection.params = params;
      const [candidate] = buildExternalCandidates([connection], []);
      expect(candidate.profile?.connectionString).toBe(`mysql://u@db:3306/app?sslmode=${mode}`);
    });
  test("flags the adapter does not read are ignored (mssql.rs:508)", () => {
    const connection = emptyExternalConnection("p", "mssql");
    connection.kind = "mssql";
    connection.host = "db";
    connection.user = "u";
    connection.database = "app";
    connection.params = [["ssl", "true"]];
    const [candidate] = buildExternalCandidates([connection], []);
    expect(candidate.profile?.connectionString).toBe("mssql://u@db:1433/app?sslmode=prefer");
  });
});

test("finding 8: a kind without adapter facts is skipped, not thrown", () => {
  const connection = emptyExternalConnection("x", "s3");
  connection.kind = "s3";
  connection.host = "bucket";
  const ok = emptyExternalConnection("y", "pg");
  ok.kind = "postgres";
  ok.host = "db";
  ok.user = "u";
  ok.database = "app";
  const candidates = buildExternalCandidates([connection, ok], []);
  expect(candidates[0].skipReason).toContain("Import-Zuordnung");
  expect(candidates[0].profile).toBeNull();
  expect(candidates[1].skipReason).toBeNull();
});
