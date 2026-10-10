import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { arch, cpus, release as osRelease, platform, totalmem } from "node:os";
import {
  buildExternalCandidates,
  countExternalImport,
  type ExternalParseResult,
  parseDataGripConfig,
  parseDbeaverConfig,
  parseNavicatExport,
  persistImportedSecrets,
  resolveExternalImport,
} from "../src/lib/connection-import";
import type { SavedConnection } from "../src/lib/connections";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

const CONNECTIONS = 2_000;
const EXISTING = 2_000;
const RUNS = 15;
const MEDIAN_BUDGET_MS = 150;
const P95_BUDGET_MS = 300;
const RETAINED_BUDGET_BYTES = 8 * 1024 * 1024;
const SECRET_CONCURRENCY = 4;

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

async function dbeaverFixture() {
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

async function navicatFixture() {
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

function datagripFixture() {
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

function heapUsed() {
  Bun.gc(true);
  return heapStats().heapSize;
}

async function scenario(name: string, parse: () => Promise<ExternalParseResult>) {
  let candidates = buildExternalCandidates((await parse()).connections, existing);
  const timing = await measureScenario(async () => {
    candidates = buildExternalCandidates((await parse()).connections, existing);
  }, RUNS);
  const retainedRounds: number[] = [];
  for (let round = 0; round < 3; round++) {
    candidates = [];
    const before = heapUsed();
    candidates = buildExternalCandidates((await parse()).connections, existing);
    retainedRounds.push(heapUsed() - before);
  }
  const retainedBytes = Math.max(0, Math.min(...retainedRounds));
  const selected = new Set(candidates.map((candidate) => candidate.index));
  const resolved = resolveExternalImport(candidates, selected, "copy");
  reportScenario(name, {
    connections: CONNECTIONS,
    existing: EXISTING,
    ...timing,
    retainedBytes,
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
  expect(retainedBytes).toBeLessThan(RETAINED_BUDGET_BYTES);
  return { candidates, resolved };
}

test("DBeaver import of 2,000 connections with encrypted credentials stays within budget", async () => {
  const fixture = await dbeaverFixture();
  const { candidates, resolved } = await scenario("connection-import-dbeaver", () =>
    parseDbeaverConfig(fixture.dataSources, fixture.credentials),
  );
  expect(candidates.filter((candidate) => candidate.skipReason)).toHaveLength(CONNECTIONS / 4);
  expect(candidates.filter((candidate) => candidate.duplicateOf)).toHaveLength(
    CONNECTIONS / 4 - CONNECTIONS / 20,
  );
  expect(resolved.summary.missingPassword).toBe(0);
  const selected = new Set(candidates.map((candidate) => candidate.index));
  const counting = await measureScenario(() => {
    for (let toggle = 0; toggle < 50; toggle++) {
      selected.delete(toggle);
      countExternalImport(candidates, selected, toggle % 2 ? "copy" : "skip");
    }
  }, RUNS);
  reportScenario("connection-import-count", { candidates: CONNECTIONS, toggles: 50, ...counting });
  expect(counting.p95Ms).toBeLessThan(50);
});

test("Navicat import of 2,000 connections batches legacy decryption into one request", async () => {
  const text = await navicatFixture();
  let requests = 0;
  let legacyValues = 0;
  const { candidates } = await scenario("connection-import-navicat", () =>
    parseNavicatExport(text, async (values) => {
      requests++;
      legacyValues += values.length;
      return values.map(() => "legacyPw123");
    }),
  );
  const parses = 1 + 2 + RUNS + 3;
  expect(requests).toBe(parses);
  expect(legacyValues).toBe(parses * (CONNECTIONS / 50));
  expect(candidates.filter((candidate) => candidate.password).length).toBe(
    candidates.filter((candidate) => !candidate.skipReason).length,
  );
});

test("DataGrip import of 2,000 data sources stays within budget", async () => {
  const files = datagripFixture();
  const { candidates } = await scenario("connection-import-datagrip", async () =>
    parseDataGripConfig(files),
  );
  expect(candidates.filter((candidate) => candidate.profile?.ssh)).toHaveLength(
    candidates.filter((candidate) => !candidate.skipReason && candidate.index % 5 === 0).length,
  );
});

test("storing 2,000 imported secrets keeps keychain concurrency bounded", async () => {
  const secrets = Array.from({ length: CONNECTIONS }, (_, index) => ({
    id: `id-${index}`,
    password: `pw-${index}`,
    sshSecret: index % 5 === 0 ? `ssh-${index}` : null,
    proxySecret: null,
  }));
  let active = 0;
  let peak = 0;
  let calls = 0;
  const started = performance.now();
  const failed = await persistImportedSecrets(
    secrets,
    async () => {
      calls++;
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
    },
    { ssh: (id) => `${id}:ssh`, proxy: (id) => `${id}:proxy` },
    SECRET_CONCURRENCY,
  );
  const elapsedMs = performance.now() - started;
  reportScenario("connection-import-secrets", { secrets: calls, peak, elapsedMs });
  expect(failed).toBe(0);
  expect(calls).toBe(CONNECTIONS + CONNECTIONS / 5);
  expect(peak).toBeLessThanOrEqual(SECRET_CONCURRENCY);
  expect(active).toBe(0);
  expect(elapsedMs).toBeLessThan(250);
});
