import { expect, test } from "bun:test";
import {
  buildExternalCandidates,
  decryptDbeaverCredentials,
  decryptNavicatPassword,
  parseDataGripConfig,
  parseDbeaverConfig,
  parseJdbcUrl,
  parseNavicatExport,
  persistImportedSecrets,
  resolveExternalImport,
} from "../src/lib/connection-import";
import { parseXml } from "../src/lib/connection-import/xml";
import type { SavedConnection } from "../src/lib/connections";

const DBEAVER_CREDENTIALS_B64 =
  "AAECAwQFBgcICQoLDA0ODz5TPlgh6DpNnKqkJUAkSBOS3K7zn7EuJ6cGXtL3R55eTLeaO9c+g6TvUWHehtWfUDpn66kbIhIvepYGCBjrYNuu/LegynTpu+aKkGMd9as0ZX58VY93b5+DJ/7jrSnaST9CalfRi6G0jdP4aUpOZCvmepH1A+nNUoPuIuKdf6Q8nq0Q2yLAkjb52uAnP3ncZ3N8oAqWi77ubCsPqmAv/alBJSN6M7/dqaFvG0dc7ntenB++8ypU0G52WAOP1G7TCVwRiwNKi7JYCeMyCUNi6cePMywVK0eHOEAeFSMcRhlR";

function credentialsFile(): Uint8Array {
  return Uint8Array.from(Buffer.from(DBEAVER_CREDENTIALS_B64, "base64"));
}

const DBEAVER_SOURCES = JSON.stringify({
  folders: { Prod: {}, "Prod/EU": { parent: "Prod" } },
  connections: {
    "postgres-jdbc-prod": {
      provider: "postgresql",
      driver: "postgres-jdbc",
      name: "Prod Postgres",
      folder: "Prod/EU",
      "save-password": true,
      configuration: {
        host: "db.internal",
        port: "5433",
        database: "app",
        url: "jdbc:postgresql://db.internal:5433/app",
        type: "prod",
        "auth-model": "native",
        handlers: {
          ssh_tunnel: {
            type: "TUNNEL",
            enabled: true,
            "save-password": true,
            properties: { host: "bastion.example.com", port: 2222, authType: "PASSWORD" },
          },
        },
      },
    },
    "mysql8-legacy": {
      provider: "mysql",
      driver: "mysql8",
      name: "Legacy MySQL (URL)",
      configuration: {
        configurationType: "URL",
        url: "jdbc:mysql://legacy.example.com:3307/shop?useSSL=false",
        type: "dev",
      },
    },
    "maria-1": {
      provider: "mysql",
      driver: "mariaDB",
      name: "Maria",
      configuration: { host: "maria.local", database: "crm", user: "crm" },
    },
    "sqlite-1": {
      provider: "generic",
      driver: "sqlite_jdbc",
      name: "Local SQLite",
      configuration: {
        database: "/home/leon/data/app.db",
        url: "jdbc:sqlite:/home/leon/data/app.db",
      },
    },
    "oracle-sid": {
      provider: "oracle",
      driver: "oracle_thin",
      name: "Oracle SID",
      configuration: {
        host: "ora.example.com",
        port: "1521",
        database: "ORCL",
        user: "scott",
        "provider-properties": { "@dbeaver-sid-service@": "SID" },
      },
    },
    "oracle-ssh": {
      provider: "oracle",
      driver: "oracle_thin",
      name: "Oracle SSH",
      configuration: {
        host: "10.2.0.7",
        port: "1521",
        database: "FREEPDB1",
        user: "hr",
        handlers: {
          ssh_tunnel: {
            type: "TUNNEL",
            enabled: true,
            properties: {
              host: "jump",
              authType: "PUBLIC_KEY",
              keyPath: "/home/leon/.ssh/id_ed25519",
            },
          },
        },
      },
    },
    "oracle-sid-ssh": {
      provider: "oracle",
      driver: "oracle_thin",
      name: "Oracle SID SSH",
      configuration: {
        url: "jdbc:oracle:thin:@10.2.0.8:1521:XE",
        user: "hr",
        handlers: { ssh_tunnel: { type: "TUNNEL", enabled: true, properties: { host: "jump" } } },
      },
    },
    "db2-1": {
      provider: "db2",
      driver: "db2_luw",
      name: "Mainframe",
      configuration: { host: "db2.example.com", port: "50000", database: "SAMPLE" },
    },
    "generic-h2": {
      provider: "generic",
      driver: "h2_embedded_v2",
      name: "H2",
      configuration: { url: "jdbc:h2:~/test" },
    },
    "custom-unknown": {
      provider: "generic",
      driver: "acme_custom",
      name: "Custom",
      configuration: { host: "acme", port: "1" },
    },
    "pg-ssh-no-host": {
      provider: "postgresql",
      driver: "postgres-jdbc",
      name: "Broken SSH",
      configuration: {
        host: "10.0.0.5",
        database: "x",
        user: "x",
        handlers: { ssh_tunnel: { type: "TUNNEL", enabled: true, properties: { port: 22 } } },
      },
    },
  },
});

test("decrypts DBeaver credentials with the default key", async () => {
  const decrypted = await decryptDbeaverCredentials(credentialsFile());
  expect(decrypted).toEqual({
    "postgres-jdbc-prod": {
      "#connection": { user: "app_owner", password: "Pg$ecret!" },
      "network/ssh_tunnel": { user: "deploy", password: "jump-pass" },
    },
    "mysql8-legacy": { "#connection": { user: "root", password: "my:pw@1" } },
  });
  const tampered = credentialsFile();
  tampered[20] ^= 0xff;
  expect(await decryptDbeaverCredentials(tampered.slice(0, 40))).toBeNull();
  expect(await decryptDbeaverCredentials(new Uint8Array(8))).toBeNull();
});

test("maps DBeaver connections, folders, credentials and SSH handlers", async () => {
  const result = await parseDbeaverConfig(DBEAVER_SOURCES, credentialsFile());
  expect(result.error).toBeNull();
  expect(result.notice).toBeNull();
  const byId = new Map(result.connections.map((entry) => [entry.sourceId, entry]));
  expect(byId.get("postgres-jdbc-prod")).toMatchObject({
    kind: "postgres",
    host: "db.internal",
    port: 5433,
    database: "app",
    user: "app_owner",
    password: "Pg$ecret!",
    folder: "Prod/EU",
    environment: "production",
    ssh: {
      host: "bastion.example.com",
      port: 2222,
      user: "deploy",
      auth: "password",
      secret: "jump-pass",
    },
  });
  expect(byId.get("mysql8-legacy")).toMatchObject({
    kind: "mysql",
    host: "legacy.example.com",
    port: 3307,
    database: "shop",
    user: "root",
    password: "my:pw@1",
    environment: "development",
    params: [["useSSL", "false"]],
  });
  expect(byId.get("maria-1")).toMatchObject({ kind: "mysql", product: "MariaDB", user: "crm" });
  expect(byId.get("sqlite-1")).toMatchObject({
    kind: "sqlite",
    database: "/home/leon/data/app.db",
  });
  expect(byId.get("oracle-sid")).toMatchObject({ kind: "oracle", oracleSid: true });
  expect(byId.get("oracle-ssh")).toMatchObject({
    kind: "oracle",
    oracleSid: false,
    ssh: { host: "jump", auth: "key", keyFile: "/home/leon/.ssh/id_ed25519", user: "" },
  });
  expect(byId.get("db2-1")?.kind).toBeNull();
  expect(byId.get("generic-h2")?.kind).toBeNull();
  expect(byId.get("custom-unknown")?.kind).toBeNull();

  const candidates = buildExternalCandidates(result.connections, []);
  const byLabel = new Map(candidates.map((entry) => [entry.label, entry]));
  const prod = byLabel.get("Prod Postgres");
  expect(prod?.profile?.connectionString).toBe(
    "postgresql://app_owner@db.internal:5433/app?sslmode=prefer",
  );
  expect(prod?.profile?.ssh).toMatchObject({
    host: "bastion.example.com",
    remoteHost: "db.internal",
    remotePort: 5433,
  });
  expect(prod?.profile?.tags).toEqual([{ name: "Prod/EU", color: expect.any(String) }]);
  expect(prod?.profile?.environment).toBe("production");
  expect(prod?.warnings).toEqual([]);
  expect(byLabel.get("Legacy MySQL (URL)")?.profile?.connectionString).toBe(
    "mysql://root@legacy.example.com:3307/shop?sslmode=disable",
  );
  expect(byLabel.get("Local SQLite")?.profile?.connectionString).toBe("/home/leon/data/app.db");
  const oracle = byLabel.get("Oracle SID");
  const oracleUrl = new URL(oracle?.profile?.connectionString ?? "");
  expect(oracleUrl.host).toBe("ora.example.com:1521");
  expect(oracleUrl.username).toBe("scott");
  expect(oracleUrl.searchParams.get("connect_string")).toBe(
    "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=ora.example.com)(PORT=1521))(CONNECT_DATA=(SID=ORCL)))",
  );
  expect(oracle?.missingPassword).toBe(true);
  const oracleSsh = byLabel.get("Oracle SSH");
  expect(oracleSsh?.profile?.connectionString).toBe("oracle://hr@10.2.0.7:1521/FREEPDB1");
  expect(oracleSsh?.profile?.ssh).toMatchObject({ remoteHost: "10.2.0.7", remotePort: 1521 });
  expect(oracleSsh?.warnings).toContain("SSH unvollständig: Benutzer fehlt.");
  expect(byLabel.get("Oracle SID SSH")?.skipReason).toContain("SID oder TNS");
  expect(byLabel.get("Mainframe")?.skipReason).toContain("Nicht unterstützter Typ");
  expect(byLabel.get("Mainframe")?.profile).toBeNull();
  expect(byLabel.get("H2")?.skipReason).toContain("h2_embedded_v2");
  expect(byLabel.get("Custom")?.skipReason).toContain("acme_custom");
  expect(byLabel.get("Broken SSH")?.skipReason).toContain("SSH-Host fehlt");
});

test("DBeaver import without credentials reports missing passwords", async () => {
  const result = await parseDbeaverConfig(DBEAVER_SOURCES, null);
  expect(result.notice).toContain("credentials-config.json");
  const candidates = buildExternalCandidates(result.connections, []);
  expect(candidates.find((entry) => entry.label === "Prod Postgres")?.missingPassword).toBe(false);
  expect(candidates.find((entry) => entry.label === "Maria")?.missingPassword).toBe(true);
  const broken = await parseDbeaverConfig(DBEAVER_SOURCES, new Uint8Array(64));
  expect(broken.notice).toContain("nicht entschlüsseln");
});

test("rejects malformed DBeaver input", async () => {
  expect((await parseDbeaverConfig("{nope", null)).error).toContain("kein gültiges JSON");
  expect((await parseDbeaverConfig('{"connections":[]}', null)).error).toContain("keine DBeaver");
  expect((await parseDbeaverConfig("[]", null)).error).toContain("keine DBeaver");
});

const DATAGRIP_SHARED = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="DataSourceManagerImpl" format="xml" multifile-model="true">
    <data-source source="LOCAL" name="shop@localhost" uuid="a1" group="Kunden/Shop">
      <driver-ref>postgresql</driver-ref>
      <synchronize>true</synchronize>
      <jdbc-driver>org.postgresql.Driver</jdbc-driver>
      <jdbc-url>jdbc:postgresql://localhost:5432/shop?sslmode=require</jdbc-url>
      <working-dir>$ProjectFileDir$</working-dir>
    </data-source>
    <data-source source="LOCAL" name="sqlserver" uuid="a2">
      <driver-ref>sqlserver.ms</driver-ref>
      <jdbc-url>jdbc:sqlserver://mssql.example.com:1433;databaseName=erp;encrypt=true</jdbc-url>
    </data-source>
    <data-source source="LOCAL" name="oracle" uuid="a3">
      <driver-ref>oracle</driver-ref>
      <jdbc-url>jdbc:oracle:thin:@//ora.example.com:1522/FREEPDB1</jdbc-url>
    </data-source>
    <data-source source="LOCAL" name="local.db" uuid="a4">
      <driver-ref>sqlite.xerial</driver-ref>
      <jdbc-url>jdbc:sqlite:$USER_HOME$/data/local.db</jdbc-url>
    </data-source>
    <data-source source="LOCAL" name="clicks" uuid="a5">
      <driver-ref>clickhouse</driver-ref>
      <jdbc-url>jdbc:clickhouse://ch.example.com:8123/analytics</jdbc-url>
    </data-source>
    <data-source source="LOCAL" name="exasol" uuid="a6">
      <driver-ref>exasol</driver-ref>
      <jdbc-url>jdbc:exa:exasol.example.com:8563</jdbc-url>
    </data-source>
    <data-source source="LOCAL" name="mystery" uuid="a7">
      <jdbc-url>jdbc:mystery://host:1/db</jdbc-url>
    </data-source>
    <data-source source="LOCAL" name="mysql via ssh" uuid="a8">
      <driver-ref>mysql.8</driver-ref>
      <jdbc-url>jdbc:mysql://10.1.0.4:3306/app</jdbc-url>
    </data-source>
    <data-source source="LOCAL" name="pg legacy ssh" uuid="a9">
      <driver-ref>postgresql</driver-ref>
      <jdbc-url>jdbc:postgresql://10.1.0.9/core</jdbc-url>
    </data-source>
  </component>
</project>`;

const DATAGRIP_LOCAL = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="dataSourceStorageLocal" created-in="DB-241.14494.283">
    <data-source name="shop@localhost" uuid="a1">
      <database-info product="PostgreSQL" version="16.2" jdbc-version="4.2" />
      <secret-storage>master_key</secret-storage>
      <user-name>shop_rw</user-name>
    </data-source>
    <data-source name="sqlserver" uuid="a2">
      <user-name>sa</user-name>
    </data-source>
    <data-source name="mysql via ssh" uuid="a8">
      <user-name>app</user-name>
      <ssh-properties>
        <enabled>true</enabled>
        <ssh-config-id>ssh-1</ssh-config-id>
      </ssh-properties>
    </data-source>
    <data-source name="pg legacy ssh" uuid="a9">
      <user-name>core</user-name>
      <ssh-properties>
        <enabled>true</enabled>
        <proxy-host>legacy-bastion</proxy-host>
        <port>2200</port>
        <user>ops</user>
        <auth-type>KEY_PAIR</auth-type>
        <key-file>$USER_HOME$/.ssh/id_rsa</key-file>
      </ssh-properties>
    </data-source>
  </component>
</project>`;

const DATAGRIP_SSH = `<application>
  <component name="SshConfigs">
    <configs>
      <sshConfig authType="OPEN_SSH" host="bastion.example.com" id="ssh-1" port="22" nameFormat="DESCRIPTIVE" username="ubuntu" useOpenSSHConfig="true" />
    </configs>
  </component>
</application>`;

test("merges DataGrip data sources, local user names and SSH configs", () => {
  const result = parseDataGripConfig([
    { name: "dataSources.xml", text: DATAGRIP_SHARED },
    { name: "dataSources.local.xml", text: DATAGRIP_LOCAL },
    { name: "sshConfigs.xml", text: DATAGRIP_SSH },
  ]);
  expect(result.error).toBeNull();
  expect(result.notice).toContain("JetBrains-Schlüsselbund");
  const candidates = buildExternalCandidates(result.connections, []);
  const byLabel = new Map(candidates.map((entry) => [entry.label, entry]));
  const shop = byLabel.get("shop@localhost");
  expect(shop?.profile).toMatchObject({
    kind: "postgres",
    connectionString: "postgresql://shop_rw@localhost:5432/shop?sslmode=require",
    sslMode: "require",
    tags: [{ name: "Kunden/Shop" }],
  });
  expect(shop?.missingPassword).toBe(true);
  expect(shop?.warnings[0]).toContain("JetBrains-Schlüsselbund");
  expect(byLabel.get("sqlserver")?.profile?.connectionString).toBe(
    "mssql://sa@mssql.example.com:1433/erp?sslmode=verify-full",
  );
  expect(byLabel.get("oracle")?.profile?.connectionString).toBe(
    "oracle://ora.example.com:1522/FREEPDB1",
  );
  expect(byLabel.get("oracle")?.warnings).toContain("Benutzer fehlt.");
  expect(byLabel.get("local.db")?.profile?.connectionString).toBe("~/data/local.db");
  expect(byLabel.get("clicks")?.profile?.kind).toBe("clickhouse");
  expect(byLabel.get("exasol")?.skipReason).toContain("Nicht unterstützter Typ");
  expect(byLabel.get("mystery")?.skipReason).toContain("mystery");
  expect(byLabel.get("mysql via ssh")?.profile?.ssh).toEqual({
    host: "bastion.example.com",
    port: 22,
    user: "ubuntu",
    auth: "agent",
    keyFile: "",
    remoteHost: "10.1.0.4",
    remotePort: 3306,
  });
  expect(byLabel.get("pg legacy ssh")?.profile?.ssh).toMatchObject({
    host: "legacy-bastion",
    port: 2200,
    user: "ops",
    auth: "key",
    keyFile: "~/.ssh/id_rsa",
    remotePort: 5432,
  });
});

test("DataGrip SSH reference without sshConfigs.xml is skipped, broken XML is reported", () => {
  const result = parseDataGripConfig([
    { name: "dataSources.xml", text: DATAGRIP_SHARED },
    { name: "dataSources.local.xml", text: DATAGRIP_LOCAL },
  ]);
  const candidate = buildExternalCandidates(result.connections, []).find(
    (entry) => entry.label === "mysql via ssh",
  );
  expect(candidate?.skipReason).toContain("sshConfigs.xml");
  expect(parseDataGripConfig([{ name: "x.xml", text: "<project><data-source" }]).error).toContain(
    "x.xml",
  );
  expect(parseDataGripConfig([{ name: "x.xml", text: "<project/>" }]).error).toContain(
    "dataSources.xml",
  );
  const partial = parseDataGripConfig([
    { name: "dataSources.xml", text: DATAGRIP_SHARED },
    { name: "broken.xml", text: "<a><b></a>" },
  ]);
  expect(partial.notice).toContain("broken.xml");
});

const NAVICAT_NCX = `<?xml version="1.0" encoding="UTF-8"?>
<Connections Ver="1.5">
  <Connection ConnectionName="pg prod" ProjectUUID="" ConnType="POSTGRESQL" OraConnType="" ServiceProvider="Default" Host="pg.example.com" Port="5432" Database="billing" UserName="billing" Password="00FF99DD211D0C515ECB698A20709847" SavePassword="true" SSL="true" SSL_PGSSLMode="REQUIRE" SSH="true" SSH_Host="jump.example.com" SSH_Port="2022" SSH_UserName="ops" SSH_AuthenMethod="PUBLICKEY" SSH_Password="" SSH_SavePassword="false" SSH_PrivateKey="/home/ops/.ssh/id_rsa" SSH_Passphrase="272CABC0647049B3F51E87ED530AA0D9" SSH_SavePassphrase="true"/>
  <Connection ConnectionName="legacy mysql" ConnType="MYSQL" ServiceProvider="Default" Host="legacy.example.com" Port="3306" UserName="root" Password="F7CD9A953A6DFF06206844" SavePassword="true" SSH="false"/>
  <Connection ConnectionName="maria &amp; co" ConnType="MARIADB" Host="maria.example.com" Port="3307" UserName="app" Password="" SavePassword="false" SSH="true" SSH_Host="" />
  <Connection ConnectionName="umlaut" ConnType="MSSQL" Host="sql.example.com" Port="1433" Database="dbo" UserName="sa" Password="ADA9737C507CA947503CEDA494B02B42" SavePassword="true"/>
  <Connection ConnectionName="ora sid" ConnType="ORACLE" OraConnType="BASIC" OraServiceNameType="SID" Host="ora.example.com" Port="1521" Database="XE" UserName="hr" Password="" SavePassword="false"/>
  <Connection ConnectionName="local sqlite" ConnType="SQLITE" DatabaseFileName="/var/data/app.sqlite" />
  <Connection ConnectionName="snow" ConnType="SNOWFLAKE" Host="acme.snowflakecomputing.com" UserName="x" />
  <Connection ConnectionName="ob oracle" ConnType="ORACLE" ServiceProvider="AliyunOceanBase" Host="ob" Port="2883" UserName="x" />
  <Connection ConnectionName="cache" ConnType="REDIS" Host="redis.example.com" Port="6380" Password="00FF99DD211D0C515ECB698A20709847" SavePassword="true" SSH="true" SSH_Host="jump" SSH_UserName="ops" SSH_AuthenMethod="PASSWORD" SSH_Password="272CABC0647049B3F51E87ED530AA0D9"/>
</Connections>`;

test("decrypts Navicat 12 passwords with self-generated vectors", async () => {
  expect(await decryptNavicatPassword("00FF99DD211D0C515ECB698A20709847")).toBe("s3cr3t!Pass");
  expect(await decryptNavicatPassword("272cabc0647049b3f51e87ed530aa0d9")).toBe("ssh-Key-Phrase");
  expect(await decryptNavicatPassword("ADA9737C507CA947503CEDA494B02B42")).toBe("ümlaut€");
  expect(await decryptNavicatPassword("F7CD9A953A6DFF06206844")).toBeNull();
  expect(await decryptNavicatPassword("zz")).toBeNull();
  expect(await decryptNavicatPassword("")).toBeNull();
});

test("maps Navicat connections with SSH, legacy fallback and unsupported types", async () => {
  const legacyCalls: string[][] = [];
  const result = await parseNavicatExport(NAVICAT_NCX, async (values) => {
    legacyCalls.push(values);
    return values.map((value) => (value === "F7CD9A953A6DFF06206844" ? "legacyPw123" : null));
  });
  expect(result.error).toBeNull();
  expect(legacyCalls).toEqual([["F7CD9A953A6DFF06206844"]]);
  const candidates = buildExternalCandidates(result.connections, []);
  const byLabel = new Map(candidates.map((entry) => [entry.label, entry]));
  const pg = byLabel.get("pg prod");
  expect(pg?.password).toBe("s3cr3t!Pass");
  expect(pg?.sshSecret).toBe("ssh-Key-Phrase");
  expect(pg?.profile).toMatchObject({
    connectionString: "postgresql://billing@pg.example.com:5432/billing?sslmode=require",
    sslMode: "require",
    ssh: {
      host: "jump.example.com",
      port: 2022,
      user: "ops",
      auth: "key",
      keyFile: "/home/ops/.ssh/id_rsa",
      remoteHost: "pg.example.com",
      remotePort: 5432,
    },
  });
  expect(byLabel.get("legacy mysql")?.password).toBe("legacyPw123");
  expect(byLabel.get("maria & co")?.skipReason).toContain("SSH-Host fehlt");
  expect(byLabel.get("umlaut")?.password).toBe("ümlaut€");
  expect(
    new URL(byLabel.get("ora sid")?.profile?.connectionString ?? "").searchParams.get(
      "connect_string",
    ),
  ).toContain("(SID=XE)");
  expect(byLabel.get("ora sid")?.warnings[0]).toContain("nicht gespeichert");
  expect(byLabel.get("local sqlite")?.profile?.connectionString).toBe("/var/data/app.sqlite");
  expect(byLabel.get("local sqlite")?.missingPassword).toBe(false);
  expect(byLabel.get("snow")?.skipReason).toContain("SNOWFLAKE");
  expect(byLabel.get("ob oracle")?.skipReason).toContain("Nicht unterstützter Typ");
  const cache = byLabel.get("cache");
  expect(cache?.profile?.connectionString).toBe("redis://@redis.example.com:6380");
  expect(cache?.password).toBe("s3cr3t!Pass");
  expect(cache?.sshSecret).toBe("ssh-Key-Phrase");
});

test("Navicat legacy passwords without decryptor are reported missing", async () => {
  const result = await parseNavicatExport(NAVICAT_NCX);
  const legacy = buildExternalCandidates(result.connections, []).find(
    (entry) => entry.label === "legacy mysql",
  );
  expect(legacy?.password).toBeNull();
  expect(legacy?.missingPassword).toBe(true);
  expect(legacy?.warnings[0]).toContain("Navicat-11");
  const failing = await parseNavicatExport(NAVICAT_NCX, async () => {
    throw new Error("offline");
  });
  expect(failing.connections.find((entry) => entry.name === "legacy mysql")?.password).toBeNull();
});

test("rejects malformed Navicat input", async () => {
  expect((await parseNavicatExport("<Connections><Connection")).error).toContain("Ungültiges XML");
  expect((await parseNavicatExport("<Connections></Connection>")).error).toContain(
    "Ungültiges XML",
  );
  expect((await parseNavicatExport("<Other/>")).error).toContain(".ncx");
  expect((await parseNavicatExport("")).error).toContain("Ungültiges XML");
});

test("parses JDBC URL variants", () => {
  expect(parseJdbcUrl("jdbc:oracle:thin:scott/tiger@ora:1521:ORCL")).toMatchObject({
    host: "ora",
    port: 1521,
    database: "ORCL",
    user: "scott",
    password: "tiger",
    oracleSid: true,
  });
  expect(
    parseJdbcUrl(
      "jdbc:oracle:thin:@(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=h1)(PORT=1525))(CONNECT_DATA=(SERVICE_NAME=svc)))",
    ),
  ).toMatchObject({ host: "h1", port: 1525, database: "svc", oracleSid: false });
  expect(
    parseJdbcUrl("jdbc:sqlserver://srv\\SQLEXPRESS;databaseName=crm;user=u;password=p"),
  ).toMatchObject({
    host: "srv",
    database: "crm",
    user: "u",
    password: "p",
    params: [["instanceName", "SQLEXPRESS"]],
  });
  expect(parseJdbcUrl("jdbc:mysql:loadbalance://a:3306,b:3306/db?user=x")).toMatchObject({
    host: "a",
    port: 3306,
    database: "db",
    user: "x",
  });
  expect(parseJdbcUrl("jdbc:postgresql://[::1]:5432/db")).toMatchObject({
    host: "::1",
    port: 5432,
  });
  expect(parseJdbcUrl("jdbc:clickhouse:http://ch:8123/default")).toMatchObject({ host: "ch" });
  expect(parseJdbcUrl("jdbc:mongodb+srv://user@cluster0.mongodb.net/app")).toMatchObject({
    srv: true,
    host: "cluster0.mongodb.net",
  });
  expect(parseJdbcUrl("jdbc:duckdb:/tmp/a.duckdb")).toMatchObject({ path: "/tmp/a.duckdb" });
  expect(parseJdbcUrl("")).toBeNull();
  expect(parseJdbcUrl("::::")).toBeNull();
});

test("xml reader handles entities, CDATA, comments and quoted angle brackets", () => {
  const root = parseXml(
    `<?xml version="1.0"?><!-- c --><a x="1 &gt; 0" y='a>b'><b>&amp;&#65;&#x42;</b><![CDATA[<raw>]]></a>`,
  );
  const a = root.children[0];
  expect(a.attributes).toEqual({ x: "1 > 0", y: "a>b" });
  expect(a.children[0].text).toBe("&AB");
  expect(a.text).toBe("<raw>");
  expect(() => parseXml("<a><b></a>")).toThrow();
  expect(() => parseXml("text only")).toThrow();
});

function existing(
  connectionString: string,
  kind: SavedConnection["kind"] = "postgres",
  extra: Partial<SavedConnection> = {},
): SavedConnection {
  return {
    id: "existing-1",
    name: "Bestehend",
    kind,
    connectionString,
    sslMode: "prefer",
    ...extra,
  };
}

const PG_PROD_SSH = {
  host: "JUMP.example.com",
  port: 2022,
  user: "ops",
  auth: "key" as const,
  keyFile: "/home/ops/.ssh/id_rsa",
  remoteHost: "pg.example.com",
  remotePort: 5432,
};

test("detects duplicates by host, port, database and user and resolves skip or copy", async () => {
  const result = await parseNavicatExport(NAVICAT_NCX);
  const candidates = buildExternalCandidates(result.connections, [
    existing("postgresql://billing:secret@PG.example.com/billing", "postgres", {
      ssh: PG_PROD_SSH,
    }),
  ]);
  const pg = candidates.find((entry) => entry.label === "pg prod");
  expect(pg?.duplicateOf?.id).toBe("existing-1");
  expect(candidates.filter((entry) => entry.duplicateOf)).toHaveLength(1);
  const selectable = new Set(
    candidates.filter((entry) => !entry.skipReason).map((entry) => entry.index),
  );

  const skipped = resolveExternalImport(candidates, selectable, "skip");
  expect(skipped.connections.some((entry) => entry.name === "pg prod")).toBe(false);
  expect(skipped.summary).toEqual({
    imported: selectable.size - 1,
    skipped: candidates.length - selectable.size + 1,
    missingPassword: 2,
  });

  const copied = resolveExternalImport(candidates, selectable, "copy");
  const copy = copied.connections.find((entry) => entry.name === "pg prod (Kopie)");
  expect(copy?.id).not.toBe(pg?.profile?.id);
  expect(copy?.connectionString).toBe(
    "postgresql://billing:s3cr3t!Pass@pg.example.com:5432/billing?sslmode=require",
  );
  expect(copied.secrets.find((entry) => entry.id === copy?.id)).toEqual({
    id: copy?.id as string,
    password: "s3cr3t!Pass",
    sshSecret: "ssh-Key-Phrase",
    proxySecret: null,
  });
  expect(copied.summary.imported).toBe(selectable.size);
  const cache = copied.connections.find((entry) => entry.name === "cache");
  expect(cache?.connectionString).toBe("redis://:s3cr3t!Pass@redis.example.com:6380");
  expect(cache?.ssh?.auth).toBe("password");
});

test("persists imported secrets to the keychain with bounded concurrency", async () => {
  const stored: Array<[string, string]> = [];
  let active = 0;
  let peak = 0;
  const failed = await persistImportedSecrets(
    [
      { id: "a", password: "pw-a", sshSecret: "ssh-a", proxySecret: null },
      { id: "b", password: null, sshSecret: "ssh-b", proxySecret: "proxy-b" },
      { id: "c", password: "pw-c", sshSecret: null, proxySecret: null },
      { id: "d", password: "pw-d", sshSecret: null, proxySecret: null },
    ],
    async (account, secret) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      if (account === "d") throw new Error("Schlüsselbund gesperrt");
      stored.push([account, secret]);
    },
    { ssh: (id) => `${id}:ssh`, proxy: (id) => `${id}:proxy` },
    2,
  );
  expect(failed).toBe(1);
  expect(peak).toBeLessThanOrEqual(2);
  expect(stored.sort()).toEqual([
    ["a", "pw-a"],
    ["a:ssh", "ssh-a"],
    ["b:proxy", "proxy-b"],
    ["b:ssh", "ssh-b"],
    ["c", "pw-c"],
  ]);
});

function dbeaverEntry(configuration: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    connections: {
      entry: {
        provider: "postgresql",
        driver: "postgres-jdbc",
        name: "Eintrag",
        configuration,
        ...extra,
      },
    },
  });
}

async function singleCandidate(configuration: Record<string, unknown>, extra = {}) {
  const parsed = await parseDbeaverConfig(dbeaverEntry(configuration, extra), null);
  const [candidate] = buildExternalCandidates(parsed.connections, []);
  return candidate;
}

test("maps SQL Server JDBC parameters to the adapter keys", () => {
  const result = parseDataGripConfig([
    {
      name: "dataSources.xml",
      text: `<project><component name="DataSourceManagerImpl"><data-source name="ms" uuid="m1"><driver-ref>sqlserver.ms</driver-ref><jdbc-url>jdbc:sqlserver://srv\\SQLEXPRESS:1433;databaseName=crm;user=sa;integratedSecurity=true;trustServerCertificate=true;encrypt=true;applicationName=erp</jdbc-url></data-source></component></project>`,
    },
  ]);
  const [candidate] = buildExternalCandidates(result.connections, []);
  const url = new URL(candidate.profile?.connectionString ?? "");
  expect(url.hostname).toBe("srv");
  expect(url.searchParams.get("instance")).toBe("SQLEXPRESS");
  expect(url.searchParams.get("integrated_security")).toBe("true");
  expect(url.searchParams.get("trust_server_certificate")).toBe("true");
  expect(url.searchParams.get("application_name")).toBe("erp");
  expect(url.searchParams.get("sslmode")).toBe("require");
  expect(url.searchParams.has("instanceName")).toBe(false);
  expect(url.searchParams.has("encrypt")).toBe(false);
  expect(candidate.profile?.sslMode).toBe("require");
});

test("splits a Navicat SQL Server host with a named instance", async () => {
  const result = await parseNavicatExport(
    `<Connections><Connection ConnectionName="ms" ConnType="MSSQL" Host="sql01\\INST2" Port="1433" UserName="sa"/></Connections>`,
  );
  const [candidate] = buildExternalCandidates(result.connections, []);
  expect(candidate.skipReason).toBeNull();
  const url = new URL(candidate.profile?.connectionString ?? "");
  expect(url.hostname).toBe("sql01");
  expect(url.searchParams.get("instance")).toBe("INST2");
});

test("maps DBeaver SOCKS and HTTP proxies and never imports them as direct connections", async () => {
  const socks = await parseDbeaverConfig(
    dbeaverEntry({
      host: "db",
      database: "app",
      user: "u",
      handlers: {
        proxy: {
          type: "PROXY",
          enabled: true,
          properties: { "socks-host": "socks.example.com", "socks-port": 1081 },
        },
      },
    }),
    null,
  );
  const [socksCandidate] = buildExternalCandidates(socks.connections, []);
  expect(socksCandidate.profile?.proxy).toEqual({
    type: "socks5",
    host: "socks.example.com",
    port: 1081,
  });
  const http = await singleCandidate({
    host: "db",
    database: "app",
    user: "u",
    handlers: {
      "http-proxy": {
        type: "PROXY",
        enabled: true,
        user: "pu",
        password: "pp",
        properties: { host: "http.example.com", port: 3128 },
      },
    },
  });
  expect(http.profile?.proxy).toEqual({
    type: "http",
    host: "http.example.com",
    port: 3128,
    username: "pu",
  });
  expect(http.proxySecret).toBe("pp");
  const resolved = resolveExternalImport([http], new Set([http.index]), "skip");
  expect(resolved.connections[0].proxy?.host).toBe("http.example.com");
  expect(resolved.secrets[0].proxySecret).toBe("pp");
  const noHost = await singleCandidate({
    host: "db",
    database: "app",
    handlers: { proxy: { type: "PROXY", enabled: true, properties: {} } },
  });
  expect(noHost.skipReason).toContain("Proxy-Host fehlt");
  expect(noHost.profile).toBeNull();
  const unknownTunnel = await singleCandidate({
    host: "db",
    database: "app",
    handlers: { k8s: { type: "TUNNEL", enabled: true, properties: { pod: "x" } } },
  });
  expect(unknownTunnel.skipReason).toContain("k8s");
  const disabled = await singleCandidate({
    host: "db",
    database: "app",
    handlers: { proxy: { type: "PROXY", enabled: false, properties: {} } },
  });
  expect(disabled.skipReason).toBeNull();
  expect(disabled.profile?.proxy).toBeUndefined();
});

test("skips Navicat HTTP tunnels instead of connecting directly", async () => {
  const result = await parseNavicatExport(
    `<Connections><Connection ConnectionName="tun" ConnType="MYSQL" Host="db" Port="3306" UserName="u" HTTP="true" HTTP_URL="https://example.com/ntunnel_mysql.php"/></Connections>`,
  );
  const [candidate] = buildExternalCandidates(result.connections, []);
  expect(candidate.skipReason).toContain("HTTP-Tunnel");
  expect(candidate.profile).toBeNull();
});

test("strips secret-like JDBC parameters from the stored connection string", () => {
  const result = parseDataGripConfig([
    {
      name: "dataSources.xml",
      text: `<project><data-source name="my" uuid="s1"><driver-ref>mysql.8</driver-ref><jdbc-url>jdbc:mysql://db:3306/app?user=u&amp;keyStorePassword=k1&amp;trustCertificateKeyStorePassword=k2&amp;clientCertificateKeyStorePassword=k3&amp;accessToken=t&amp;useUnicode=true</jdbc-url></data-source></project>`,
    },
  ]);
  const [candidate] = buildExternalCandidates(result.connections, []);
  const stored = candidate.profile?.connectionString ?? "";
  for (const secret of ["k1", "k2", "k3", "accessToken", "KeyStorePassword"])
    expect(stored).not.toContain(secret);
  expect(stored).toContain("useUnicode=true");
  expect(candidate.warnings.join(" ")).toContain("keyStorePassword");
  const resolved = resolveExternalImport([candidate], new Set([candidate.index]), "skip");
  expect(resolved.connections[0].connectionString).not.toContain("k1");
});

test("keeps a host rule's production environment over an imported environment", async () => {
  const parsed = await parseDbeaverConfig(
    dbeaverEntry({ host: "prod-db.example.com", database: "app", user: "u", type: "dev" }),
    null,
  );
  const [candidate] = buildExternalCandidates(parsed.connections, []);
  expect(candidate.profile?.environment).toBe("development");
  const rules = [{ id: "r1", name: "Prod", pattern: "prod-*", environment: "production" as const }];
  const guarded = resolveExternalImport([candidate], new Set([0]), "skip", rules);
  expect(guarded.connections[0].environment).toBeUndefined();
  const unguarded = resolveExternalImport([candidate], new Set([0]), "skip", []);
  expect(unguarded.connections[0].environment).toBe("development");
});

test("maps SSL settings without downgrading to prefer", async () => {
  const mode = async (url: string, handlers?: Record<string, unknown>) =>
    (await singleCandidate({ url, user: "u", ...(handlers ? { handlers } : {}) })).profile?.sslMode;
  expect(await mode("jdbc:postgresql://db/app?ssl=true")).toBe("verify-full");
  expect(
    await mode(
      "jdbc:postgresql://db/app?ssl=true&sslfactory=org.postgresql.ssl.NonValidatingFactory",
    ),
  ).toBe("require");
  expect(await mode("jdbc:postgresql://db/app?ssl=true&sslmode=verify-ca")).toBe("verify-ca");
  expect(await mode("jdbc:postgresql://db/app?ssl=false")).toBe("disable");
  expect(await mode("jdbc:postgresql://db/app")).toBe("prefer");
  expect(
    await mode("jdbc:postgresql://db/app", {
      postgre_ssl: { type: "CONFIG", enabled: true, properties: { sslMode: "verify-ca" } },
    }),
  ).toBe("verify-ca");
  expect(
    await mode("jdbc:postgresql://db/app", {
      postgre_ssl: { type: "CONFIG", enabled: true, properties: {} },
    }),
  ).toBe("verify-full");
  const ssl = await singleCandidate({ url: "jdbc:postgresql://db/app?ssl=true", user: "u" });
  const url = new URL(ssl.profile?.connectionString ?? "");
  expect(url.searchParams.get("sslmode")).toBe("verify-full");
  expect(url.searchParams.has("ssl")).toBe(false);
  const mysql = await parseDbeaverConfig(
    JSON.stringify({
      connections: {
        m: {
          provider: "mysql",
          driver: "mysql8",
          name: "m",
          configuration: { url: "jdbc:mysql://db:3306/app?sslMode=REQUIRED", user: "u" },
        },
      },
    }),
    null,
  );
  expect(buildExternalCandidates(mysql.connections, [])[0].profile?.sslMode).toBe("require");
  const navicat = await parseNavicatExport(
    `<Connections><Connection ConnectionName="n" ConnType="MYSQL" Host="db" UserName="u" SSL="true"/></Connections>`,
  );
  expect(buildExternalCandidates(navicat.connections, [])[0].profile?.sslMode).toBe("verify-full");
});

test("duplicate detection includes the SSH tunnel and proxy", async () => {
  const result = await parseNavicatExport(NAVICAT_NCX);
  const direct = buildExternalCandidates(result.connections, [
    existing("postgresql://billing@pg.example.com/billing"),
  ]);
  expect(direct.find((entry) => entry.label === "pg prod")?.duplicateOf).toBeNull();
  const otherJump = buildExternalCandidates(result.connections, [
    existing("postgresql://billing@pg.example.com/billing", "postgres", {
      ssh: { ...PG_PROD_SSH, host: "other-jump" },
    }),
  ]);
  expect(otherJump.find((entry) => entry.label === "pg prod")?.duplicateOf).toBeNull();
  const viaProxy = buildExternalCandidates(result.connections, [
    existing("postgresql://billing@pg.example.com/billing", "postgres", {
      ssh: PG_PROD_SSH,
      proxy: { type: "socks5", host: "socks", port: 1080 },
    }),
  ]);
  expect(viaProxy.find((entry) => entry.label === "pg prod")?.duplicateOf).toBeNull();
});

test("Redis with a password but no user keeps an empty user", async () => {
  const result = await parseNavicatExport(NAVICAT_NCX);
  const cache = buildExternalCandidates(result.connections, []).find(
    (entry) => entry.label === "cache",
  );
  const resolved = resolveExternalImport(
    cache ? [cache] : [],
    new Set([cache?.index ?? -1]),
    "skip",
  );
  const url = new URL(resolved.connections[0].connectionString);
  expect(url.username).toBe("");
  expect(url.password).toBe("s3cr3t!Pass");
});

test("xml reader skips DOCTYPE declarations with an internal subset", () => {
  const root = parseXml(
    `<?xml version="1.0"?><!DOCTYPE Connections [<!ELEMENT Connections ANY><!ATTLIST Connection Host CDATA "x>y"><!-- ] > --><!ENTITY e "v">]><Connections><Connection Host="h"/></Connections>`,
  );
  expect(root.children[0].name).toBe("Connections");
  expect(root.children[0].children[0].attributes.Host).toBe("h");
  expect(() => parseXml("<!DOCTYPE x [<!ELEMENT x ANY>")).toThrow();
});
