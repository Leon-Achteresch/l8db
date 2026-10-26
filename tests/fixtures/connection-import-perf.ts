import { heapStats } from "bun:jsc";
import { expect } from "bun:test";
import { arch, cpus, release as osRelease, platform, totalmem } from "node:os";
import {
  buildExternalCandidates,
  type ExternalImportCandidate,
  type ExternalParseResult,
  resolveExternalImport,
} from "../../src/lib/connection-import";
import type { SavedConnection } from "../../src/lib/connections";
import type { EndpointRequest, EndpointResult } from "../../src/lib/db";
import { measureScenario, reportScenario } from "./usage-performance";

export const CONNECTIONS = 2_000;
const EXISTING = 2_000;
export const RUNS = 15;
export const RETAINED_ROUNDS = 5;
const MEDIAN_BUDGET_MS = 150;
const P95_BUDGET_MS = 300;
const RETAINED_BUDGET_BYTES = 8 * 1024 * 1024;
export const SECRET_CONCURRENCY = 4;

const DBEAVER_KEY = Uint8Array.from(Buffer.from("babb4a9f774ab853c96c2d653dfe544a", "hex"));
const NAVICAT_KEY = new TextEncoder().encode("libcckeylibcckey");
const NAVICAT_IV = new TextEncoder().encode("libcciv libcciv ");

async function aesEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array) {
  const imported = await crypto.subtle.importKey("raw", key as BufferSource, "AES-CBC", false, [
    "encrypt",
  ]);
  return new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-CBC", iv: iv as BufferSource },
      imported,
      data as BufferSource,
    ),
  );
}

const KINDS = [
  ["postgresql", "postgres-jdbc", "POSTGRESQL", "postgresql", 5432],
  ["mysql", "mysql8", "MYSQL", "mysql.8", 3306],
  ["sqlserver", "microsoft", "MSSQL", "sqlserver.ms", 1433],
  ["db2", "db2_luw", "DB2", "exasol", 50000],
] as const;

export async function dbeaverFixture() {
  const connections: Record<string, unknown> = {};
  const credentials: Record<string, unknown> = {};
  for (let index = 0; index < CONNECTIONS; index++) {
    const [provider, driver, , , port] = KINDS[index % KINDS.length];
    const id = `conn-${index}`;
    connections[id] = {
      provider,
      driver,
      name: `Verbindung ${index}`,
      folder: `Team ${index % 25}/Umgebung ${index % 4}`,
      configuration: {
        host: `db-${index}.internal.example.com`,
        port: String(port),
        database: `app_${index}`,
        url: `jdbc:${provider}://db-${index}.internal.example.com:${port}/app_${index}`,
        type: index % 3 === 0 ? "prod" : "dev",
        handlers:
          index % 5 === 0
            ? {
                ssh_tunnel: {
                  type: "TUNNEL",
                  enabled: true,
                  properties: { host: `jump-${index % 10}`, port: 22, authType: "PASSWORD" },
                },
              }
            : {},
      },
    };
    credentials[id] = {
      "#connection": { user: `user_${index}`, password: `pw-${index}-${"x".repeat(index % 17)}` },
      ...(index % 5 === 0
        ? { "network/ssh_tunnel": { user: "ops", password: `ssh-${index}` } }
        : {}),
    };
  }
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const encrypted = await aesEncrypt(
    DBEAVER_KEY,
    iv,
    new TextEncoder().encode(JSON.stringify(credentials)),
  );
  const file = new Uint8Array(16 + encrypted.length);
  file.set(iv);
  file.set(encrypted, 16);
  return { dataSources: JSON.stringify({ folders: {}, connections }), credentials: file };
}

export async function navicatFixture() {
  const cipher = Buffer.from(
    await aesEncrypt(NAVICAT_KEY, NAVICAT_IV, new TextEncoder().encode("navicat-secret")),
  )
    .toString("hex")
    .toUpperCase();
  const rows: string[] = [];
  for (let index = 0; index < CONNECTIONS; index++) {
    const [, , connType, , port] = KINDS[index % KINDS.length];
    const legacy = index % 50 === 0 ? "F7CD9A953A6DFF06206844" : cipher;
    const ssh =
      index % 5 === 0
        ? ` SSH="true" SSH_Host="jump-${index % 10}" SSH_Port="22" SSH_UserName="ops" SSH_AuthenMethod="PASSWORD" SSH_Password="${cipher}"`
        : ` SSH="false"`;
    rows.push(
      `  <Connection ConnectionName="Navicat ${index} &amp; Co" ConnType="${connType}" ServiceProvider="Default" Host="nav-${index}.example.com" Port="${port}" Database="db_${index}" UserName="user_${index}" Password="${legacy}" SavePassword="true"${ssh}/>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Connections Ver="1.5">\n${rows.join("\n")}\n</Connections>`;
}

export function datagripFixture() {
  const shared: string[] = [];
  const local: string[] = [];
  for (let index = 0; index < CONNECTIONS; index++) {
    const [subprotocol, , , driverRef, port] = KINDS[index % KINDS.length];
    shared.push(
      `    <data-source source="LOCAL" name="dg ${index}" uuid="uuid-${index}" group="Gruppe ${index % 30}">\n      <driver-ref>${driverRef}</driver-ref>\n      <synchronize>true</synchronize>\n      <jdbc-url>jdbc:${subprotocol}://dg-${index}.example.com:${port}/db_${index}</jdbc-url>\n    </data-source>`,
    );
    local.push(
      `    <data-source name="dg ${index}" uuid="uuid-${index}">\n      <database-info product="PostgreSQL" version="16.2"/>\n      <user-name>user_${index}</user-name>\n${index % 5 === 0 ? `      <ssh-properties><enabled>true</enabled><ssh-config-id>ssh-${index % 10}</ssh-config-id></ssh-properties>\n` : ""}    </data-source>`,
    );
  }
  const ssh = Array.from(
    { length: 10 },
    (_, index) =>
      `<sshConfig authType="KEY_PAIR" host="jump-${index}" id="ssh-${index}" port="22" username="ops" keyPath="$USER_HOME$/.ssh/id_rsa"/>`,
  ).join("");
  return [
    {
      name: "dataSources.xml",
      text: `<project version="4"><component name="DataSourceManagerImpl">\n${shared.join("\n")}\n</component></project>`,
    },
    {
      name: "dataSources.local.xml",
      text: `<project version="4"><component name="dataSourceStorageLocal">\n${local.join("\n")}\n</component></project>`,
    },
    { name: "sshConfigs.xml", text: `<application><configs>${ssh}</configs></application>` },
  ];
}

const existing: SavedConnection[] = Array.from({ length: EXISTING }, (_, index) => ({
  id: `existing-${index}`,
  name: `Bestand ${index}`,
  kind: "postgres",
  connectionString: `postgresql://user_${index}@db-${index}.internal.example.com:5432/app_${index}`,
  sslMode: "prefer",
}));

const DEFAULT_PORTS: Record<string, number> = {
  postgres: 5432,
  mysql: 3306,
  mssql: 1433,
  clickhouse: 8123,
};

const ipc = { calls: 0, requests: 0 };

async function syntheticEndpoints(requests: EndpointRequest[]): Promise<EndpointResult[]> {
  ipc.calls++;
  ipc.requests = requests.length;
  return requests.map(({ kind, url }) => {
    const parsed = new URL(url);
    const mode = parsed.searchParams.get("sslmode") ?? "";
    const tls = ["require", "verify-ca", "verify-full"].includes(mode);
    return {
      identity: {
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : (DEFAULT_PORTS[kind] ?? null),
        transport: "",
        tls,
        verify: mode.startsWith("verify"),
        database: decodeURIComponent(parsed.pathname.slice(1)),
        schema: "",
        user: decodeURIComponent(parsed.username),
        params: [],
      },
      error: null,
    };
  });
}

function build(connections: Parameters<typeof buildExternalCandidates>[0]) {
  return buildExternalCandidates(connections, existing, syntheticEndpoints);
}

function heap() {
  Bun.gc(true);
  return heapStats();
}

export async function scenario(name: string, parse: () => Promise<ExternalParseResult>) {
  ipc.calls = 0;
  let candidates = await build((await parse()).connections);
  expect(ipc.calls).toBe(1);
  expect(ipc.requests).toBe(
    EXISTING + candidates.filter((candidate) => candidate.profile || candidate.endpoint).length,
  );
  const batch = ipc.requests;
  const timing = await measureScenario(async () => {
    candidates = await build((await parse()).connections);
  }, RUNS);
  const held: ExternalImportCandidate[][] = [];
  const parsedInputs = await Promise.all(
    Array.from({ length: RETAINED_ROUNDS }, async () => (await parse()).connections),
  );
  candidates = [];
  const before = heap();
  for (const input of parsedInputs) held.push(await build(input));
  const after = heap();
  const retainedBytes = Math.round((after.heapSize - before.heapSize) / RETAINED_ROUNDS);
  const retainedObjects = Math.round((after.objectCount - before.objectCount) / RETAINED_ROUNDS);
  candidates = held[held.length - 1] ?? [];
  const selected = new Set(candidates.map((candidate) => candidate.index));
  const resolved = resolveExternalImport(candidates, selected, "copy");
  reportScenario(name, {
    connections: CONNECTIONS,
    existing: EXISTING,
    ...timing,
    ipcCallsPerPreview: 1,
    endpointRequests: batch,
    retainedBytes,
    retainedObjects,
    imported: resolved.summary.imported,
    skipped: resolved.summary.skipped,
    duplicates: candidates.filter((candidate) => candidate.duplicateOf).length,
    machine: {
      os: `${platform()} ${osRelease()}`,
      arch: arch(),
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      ramGb: Math.round(totalmem() / 1024 ** 3),
      runtime: `bun ${Bun.version}`,
    },
  });
  expect(candidates).toHaveLength(CONNECTIONS);
  expect(timing.medianMs).toBeLessThan(MEDIAN_BUDGET_MS);
  expect(timing.p95Ms).toBeLessThan(P95_BUDGET_MS);
  expect(retainedBytes).toBeGreaterThan(0);
  expect(retainedBytes).toBeLessThan(RETAINED_BUDGET_BYTES);
  return { candidates, resolved };
}
