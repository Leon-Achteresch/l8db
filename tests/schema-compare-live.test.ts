import { beforeAll, describe, expect, test } from "bun:test";

import { type SavedConnection, useConnectionsStore } from "../src/lib/connections";
import { type CatalogObject, executeScript, loadSchemaCatalog } from "../src/lib/db";
import { defaultSelection } from "../src/lib/schema-compare/diff";
import { type RunStep, runSyncStatements } from "../src/lib/schema-compare/run";
import { buildSyncScript, type SyncScript } from "../src/lib/schema-compare/script";
import {
  reverseSchemaCompare,
  runSchemaCompare,
  useSchemaCompareStore,
} from "../src/lib/schema-compare/store";
import {
  type CompareResult,
  type CompareSide,
  compareTypesFor,
  DEFAULT_COMPARE_OPTIONS,
  type SchemaCompareOptions,
} from "../src/lib/schema-compare/types";

const BRIDGE = process.env.L8DB_SCHEMA_COMPARE_LIVE;
const PG_URL = process.env.L8DB_SC_PG_URL;
const ORACLE_URL = process.env.L8DB_SC_ORACLE_URL;
const TIMEOUT = 600_000;

const PG: SavedConnection = {
  id: "sc-pg",
  name: "PG Lab",
  kind: "postgres",
  connectionString: PG_URL ?? "",
  sslMode: "disable",
};
const PG_OTHER: SavedConnection = { ...PG, id: "sc-pg-2", name: "PG Lab 2" };
const ORA: SavedConnection = {
  id: "sc-ora",
  name: "Oracle Lab",
  kind: "oracle",
  connectionString: ORACLE_URL ?? "",
  sslMode: "disable",
};

beforeAll(() => {
  if (!BRIDGE) return;
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      transformCallback: () => 0,
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        const response = await fetch(BRIDGE, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ command, args }),
        });
        const body = (await response.json()) as { result?: unknown; error?: string };
        if (body.error) throw new Error(body.error);
        return body.result;
      },
    },
  });
  useConnectionsStore.setState({ connections: [PG, PG_OTHER, ORA] });
});

function connectionById(id: string | null): SavedConnection {
  const found = [PG, PG_OTHER, ORA].find((item) => item.id === id);
  if (!found) throw new Error(`Unbekannte Verbindung ${id}`);
  return found;
}

async function sql(connection: SavedConnection, text: string, database?: string) {
  const results = await executeScript(
    connection.kind,
    connection.connectionString,
    text,
    database,
    {
      confirmed: true,
      track: false,
    },
  );
  const failed = results.find((item) => !item.success);
  if (failed) throw new Error(`${failed.error}\n--- ${failed.statement}`);
}

async function catalog(side: CompareSide): Promise<CatalogObject[]> {
  const connection = connectionById(side.connectionId);
  const objects = await loadSchemaCatalog(
    connection.kind,
    connection.connectionString,
    side.schema ?? "",
    compareTypesFor(connection.kind),
    side.database ?? undefined,
  );
  return objects.sort((a, b) =>
    `${a.object_type}|${a.parent}|${a.name}`.localeCompare(
      `${b.object_type}|${b.parent}|${b.name}`,
    ),
  );
}

async function compare(
  source: CompareSide,
  target: CompareSide,
  options: Partial<SchemaCompareOptions> = {},
): Promise<CompareResult> {
  useSchemaCompareStore.setState({
    source,
    target,
    types: compareTypesFor(connectionById(source.connectionId).kind),
    options: { ...DEFAULT_COMPARE_OPTIONS, ...options },
    result: null,
    error: null,
  });
  await runSchemaCompare();
  return current();
}

function current(): CompareResult {
  const { result, error } = useSchemaCompareStore.getState();
  if (error || !result) throw new Error(error ?? "Kein Vergleichsergebnis");
  return result;
}

function open(result: CompareResult): string[] {
  return result.items
    .filter((item) => item.status !== "identical")
    .map(
      (item) => `${item.status} ${item.type} ${item.parent ?? ""}.${item.name} ${item.differsBy}`,
    );
}

function everything(result: CompareResult): Record<string, boolean> {
  return Object.fromEntries(
    result.items.filter((item) => item.status !== "identical").map((item) => [item.key, true]),
  );
}

async function run(result: CompareResult, selection: Record<string, boolean>, dryRun: boolean) {
  const script = buildSyncScript(result, selection);
  const steps: RunStep[] = [];
  const summary = await runSyncStatements(
    connectionById(result.target.connectionId),
    { database: result.target.database, schema: result.targetSchema },
    script.statements,
    {
      continueOnError: false,
      dryRun,
      stopped: () => false,
      onStep: (index, step) => {
        steps[index] = step;
      },
    },
  );
  return { script, steps, summary };
}

async function apply(
  result: CompareResult,
  selection: Record<string, boolean>,
  dryRun = false,
): Promise<{ script: SyncScript; steps: RunStep[]; failed: number; incomplete: boolean }> {
  const script = buildSyncScript(result, selection);
  const steps: RunStep[] = [];
  const summary = await runSyncStatements(
    connectionById(result.target.connectionId),
    { database: result.target.database, schema: result.targetSchema },
    script.statements,
    {
      continueOnError: false,
      dryRun,
      stopped: () => false,
      onStep: (index, step) => {
        steps[index] = step;
      },
    },
  );
  const problems = script.statements
    .map((statement, index) => ({ statement, step: steps[index] }))
    .filter(({ step }) => step?.status === "error" || (!dryRun && step?.status === "warning"))
    .map(({ statement, step }) => `${step.message}\n--- ${statement.sql}`);
  if (summary.failed > 0 || problems.length > 0)
    throw new Error(
      `${dryRun ? "Probelauf" : "Ausführung"} fehlgeschlagen:\n${problems.join("\n\n")}`,
    );
  return { script, steps, failed: summary.failed, incomplete: summary.incomplete };
}

function blocked(script: SyncScript): string[] {
  return script.warnings
    .filter((warning) => /berechnete Spalte|manuell angepasst/.test(warning))
    .map((warning) => `different column ${/^Spalte (\S+):/.exec(warning)?.[1]}`)
    .sort();
}

function openColumns(result: CompareResult, status = "different"): string[] {
  return result.items
    .filter((item) => item.status !== "identical")
    .map((item) => `${item.status} ${item.type} ${item.parent ?? ""}.${item.name}`)
    .filter((line) => line.startsWith(status))
    .sort();
}

async function converge(result: CompareResult, selection = everything(result)) {
  const target: CompareSide = result.target;
  const before = await catalog(target);
  const dry = await apply(result, selection, true);
  expect(dry.incomplete).toBe(false);
  expect(await catalog(target)).toEqual(before);
  const run = await apply(result, selection);
  const source: CompareSide = useSchemaCompareStore.getState().source;
  const after = await compare(source, target, result.options);
  return { run, after, expected: blocked(run.script) };
}

const pgSide = (schema: string, database = "sc", connection = PG): CompareSide => ({
  connectionId: connection.id,
  database,
  schema,
});

function pgRich(s: string): string {
  return `
CREATE SCHEMA ${s};
CREATE TYPE ${s}.mood AS ENUM ('sad', 'ok', 'happy');
CREATE DOMAIN ${s}.posint AS integer CHECK (VALUE > 0);
CREATE TYPE ${s}.addr AS (street text, zip varchar(10));
CREATE SEQUENCE ${s}.order_no START 1000 INCREMENT 5;
CREATE FUNCTION ${s}.is_positive(n numeric) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT n > 0 $$;
CREATE TABLE ${s}.customer (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  email varchar(200) CONSTRAINT customer_email_key UNIQUE,
  mood ${s}.mood DEFAULT 'ok',
  score ${s}.posint,
  home ${s}.addr,
  created timestamptz NOT NULL DEFAULT now(),
  code text COLLATE "C",
  code_len integer GENERATED ALWAYS AS (length(code)) STORED,
  name_upper text GENERATED ALWAYS AS (upper(name)) STORED
);
CREATE TABLE ${s}.orders (
  id bigserial PRIMARY KEY,
  customer_id integer NOT NULL CONSTRAINT orders_customer_fk REFERENCES ${s}.customer(id) ON DELETE CASCADE,
  no integer NOT NULL DEFAULT nextval('${s}.order_no'),
  amount numeric(12,2) NOT NULL CONSTRAINT orders_amount_check CHECK (amount >= 0),
  period tsrange,
  CONSTRAINT orders_positive CHECK (${s}.is_positive(amount + 1)),
  CONSTRAINT orders_no_overlap EXCLUDE USING gist (period WITH &&)
);
CREATE INDEX orders_amount_idx ON ${s}.orders (amount DESC) WHERE amount > 100;
CREATE UNIQUE INDEX customer_lower_email ON ${s}.customer (lower(email));
CREATE TABLE ${s}.events (id integer, at date NOT NULL) PARTITION BY RANGE (at);
CREATE TABLE ${s}.events_2026 PARTITION OF ${s}.events FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE UNLOGGED TABLE ${s}.cache (k text PRIMARY KEY, v jsonb);
CREATE VIEW ${s}.big_orders AS SELECT o.id, c.name FROM ${s}.orders o JOIN ${s}.customer c ON c.id = o.customer_id WHERE o.amount > 100;
CREATE VIEW ${s}.big_order_names AS SELECT name FROM ${s}.big_orders;
CREATE MATERIALIZED VIEW ${s}.order_stats AS SELECT customer_id, sum(amount) AS total FROM ${s}.orders GROUP BY customer_id;
CREATE UNIQUE INDEX order_stats_pk ON ${s}.order_stats (customer_id);
CREATE FUNCTION ${s}.order_total(c integer) RETURNS numeric LANGUAGE sql STABLE AS $$ SELECT coalesce(sum(amount), 0) FROM ${s}.orders WHERE customer_id = c $$;
CREATE FUNCTION ${s}.customer_label(c ${s}.customer) RETURNS text LANGUAGE sql AS $$ SELECT c.name || ' <' || c.email || '>' $$;
CREATE FUNCTION ${s}.touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.created := now(); RETURN NEW; END $$;
CREATE PROCEDURE ${s}.purge(days integer) LANGUAGE plpgsql AS $$ BEGIN DELETE FROM ${s}.orders WHERE id < days; END $$;
CREATE TRIGGER customer_touch BEFORE UPDATE ON ${s}.customer FOR EACH ROW EXECUTE FUNCTION ${s}.touch();
CREATE TRIGGER customer_touch_insert BEFORE INSERT ON ${s}.customer FOR EACH ROW EXECUTE FUNCTION ${s}.touch();
ALTER TABLE ${s}.customer DISABLE TRIGGER customer_touch_insert;
COMMENT ON TABLE ${s}.customer IS 'Kunden';
COMMENT ON COLUMN ${s}.customer.name IS 'Voller Name';
COMMENT ON VIEW ${s}.big_orders IS 'Große Aufträge';
COMMENT ON MATERIALIZED VIEW ${s}.order_stats IS 'Statistik';
GRANT SELECT ON ${s}.customer TO sc_reader;
GRANT SELECT, UPDATE ON ${s}.big_orders TO sc_reader;
GRANT USAGE ON SEQUENCE ${s}.order_no TO sc_reader;
INSERT INTO ${s}.customer (name, email) VALUES ('Ada', 'ada@example.com'), ('Bob', 'bob@example.com');
INSERT INTO ${s}.orders (customer_id, amount) VALUES (1, 150), (2, 20);
REFRESH MATERIALIZED VIEW ${s}.order_stats;
`;
}

function pgVariant(s: string): string {
  return `
CREATE SCHEMA ${s};
CREATE TYPE ${s}.mood AS ENUM ('sad', 'ok', 'happy');
CREATE DOMAIN ${s}.posint AS integer CHECK (VALUE > 0);
CREATE TYPE ${s}.addr AS (street text, zip varchar(10));
CREATE TYPE ${s}.legacy_kind AS ENUM ('x', 'y');
CREATE SEQUENCE ${s}.order_no START 1000 INCREMENT 1;
CREATE SEQUENCE ${s}.legacy_seq;
CREATE FUNCTION ${s}.is_positive(n numeric) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT n > 0 $$;
CREATE TABLE ${s}.customer (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name varchar(80) NOT NULL,
  email varchar(200) CONSTRAINT customer_email_key UNIQUE,
  mood ${s}.mood DEFAULT 'sad',
  score ${s}.posint,
  home ${s}.addr,
  created timestamptz DEFAULT now(),
  code varchar(20) COLLATE "C",
  code_len integer GENERATED ALWAYS AS (length(code)) STORED,
  legacy_flag boolean
);
CREATE TABLE ${s}.orders (
  id bigserial PRIMARY KEY,
  customer_id integer NOT NULL CONSTRAINT orders_customer_fk REFERENCES ${s}.customer(id),
  no integer NOT NULL DEFAULT nextval('${s}.order_no'),
  amount numeric(12,2) NOT NULL CONSTRAINT orders_amount_check CHECK (amount >= 1),
  period tsrange,
  CONSTRAINT orders_positive CHECK (${s}.is_positive(amount + 1)),
  CONSTRAINT orders_no_overlap EXCLUDE USING gist (period WITH &&)
);
CREATE INDEX orders_customer_idx ON ${s}.orders (customer_id);
CREATE UNIQUE INDEX customer_lower_email ON ${s}.customer (lower(email));
CREATE TABLE ${s}.events (id integer, at date NOT NULL) PARTITION BY RANGE (at);
CREATE TABLE ${s}.events_2026 PARTITION OF ${s}.events FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE ${s}.legacy (id integer PRIMARY KEY, customer_id integer REFERENCES ${s}.customer(id), kind ${s}.legacy_kind);
CREATE VIEW ${s}.big_orders AS SELECT o.id, c.name FROM ${s}.orders o JOIN ${s}.customer c ON c.id = o.customer_id WHERE o.amount > 50;
CREATE VIEW ${s}.big_order_names AS SELECT name FROM ${s}.big_orders;
CREATE VIEW ${s}.legacy_view AS SELECT id FROM ${s}.legacy;
CREATE MATERIALIZED VIEW ${s}.order_stats AS SELECT customer_id, sum(amount) AS total, count(*) AS orders FROM ${s}.orders GROUP BY customer_id;
CREATE FUNCTION ${s}.order_total(c integer) RETURNS numeric LANGUAGE sql STABLE AS $$ SELECT sum(amount) FROM ${s}.orders WHERE customer_id = c $$;
CREATE FUNCTION ${s}.customer_label(c ${s}.customer) RETURNS text LANGUAGE sql AS $$ SELECT c.name $$;
CREATE FUNCTION ${s}.touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.created := now(); RETURN NEW; END $$;
CREATE FUNCTION ${s}.legacy_fn(k ${s}.legacy_kind) RETURNS integer LANGUAGE sql AS $$ SELECT count(*)::integer FROM ${s}.legacy WHERE kind = k $$;
CREATE PROCEDURE ${s}.purge(days integer) LANGUAGE plpgsql AS $$ BEGIN DELETE FROM ${s}.orders WHERE id < days; END $$;
CREATE TRIGGER customer_touch BEFORE UPDATE ON ${s}.customer FOR EACH ROW EXECUTE FUNCTION ${s}.touch();
CREATE TRIGGER customer_touch_insert BEFORE INSERT ON ${s}.customer FOR EACH ROW EXECUTE FUNCTION ${s}.touch();
COMMENT ON TABLE ${s}.customer IS 'Kundenstamm';
COMMENT ON TABLE ${s}.legacy IS 'Alt';
GRANT INSERT ON ${s}.customer TO sc_reader;
INSERT INTO ${s}.customer (name, email) VALUES ('Cleo', 'cleo@example.com');
INSERT INTO ${s}.orders (customer_id, amount) VALUES (1, 70);
`;
}

const PG_BOOT = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sc_reader') THEN CREATE ROLE sc_reader; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS btree_gist;
`;

async function pgReset(schemas: string[], database = "sc") {
  await sql(
    PG,
    schemas.map((schema) => `DROP SCHEMA IF EXISTS ${schema} CASCADE;`).join("\n"),
    database,
  );
}

describe.skipIf(!BRIDGE || !PG_URL)("Schema-Vergleich live: PostgreSQL", () => {
  beforeAll(async () => {
    await sql(PG, PG_BOOT, "sc");
    await sql(PG, "SELECT 1", "sc");
    await sql(PG, "DROP DATABASE IF EXISTS sc2 WITH (FORCE)");
    await sql(PG, "CREATE DATABASE sc2");
    await sql(PG, PG_BOOT, "sc2");
  }, TIMEOUT);

  test(
    "erstellt alle Objekttypen in einem leeren Zielschema, Probelauf ändert nichts",
    async () => {
      await pgReset(["sca", "scc"]);
      await sql(PG, `${pgRich("sca")}\nCREATE SCHEMA scc;`, "sc");
      const result = await compare(pgSide("sca"), pgSide("scc"));
      expect(result.items.every((item) => item.status === "only_source")).toBe(true);
      const types = new Set(
        result.items.flatMap((item) => [
          item.type,
          ...item.children.map((child) => child.object_type),
        ]),
      );
      expect(compareTypesFor("postgres").filter((type) => !types.has(type))).toEqual([]);
      const { after } = await converge(result, defaultSelection(result.items));
      expect(open(after)).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "gleicht Unterschiede in beide Richtungen an",
    async () => {
      await pgReset(["sca", "scb"]);
      await sql(PG, `${pgRich("sca")}\n${pgVariant("scb")}`, "sc");
      const forward = await compare(pgSide("sca"), pgSide("scb"));
      const statuses = new Set(forward.items.map((item) => item.status));
      expect([...statuses].sort()).toEqual([
        "different",
        "identical",
        "only_source",
        "only_target",
      ]);
      const { after, expected } = await converge(forward);
      expect(expected).toEqual([
        "different column customer.code",
        "different column customer.code_len",
      ]);
      expect(openColumns(after)).toEqual(expected);

      await pgReset(["scb"]);
      await sql(PG, pgVariant("scb"), "sc");
      await compare(pgSide("sca"), pgSide("scb"));
      await reverseSchemaCompare();
      const reverse = current();
      expect(reverse.sourceSchema).toBe("scb");
      expect(reverse.targetSchema).toBe("sca");
      expect(useSchemaCompareStore.getState().target.schema).toBe("sca");
      const back = await converge(reverse);
      expect(back.expected).toEqual([
        "different column customer.code",
        "different column customer.code_len",
      ]);
      expect(openColumns(back.after)).toEqual(back.expected);
    },
    TIMEOUT,
  );

  test(
    "Standardauswahl erstellt und ändert, löscht aber nichts im Ziel",
    async () => {
      await pgReset(["sca", "scb"]);
      await sql(PG, `${pgRich("sca")}\n${pgVariant("scb")}`, "sc");
      const result = await compare(pgSide("sca"), pgSide("scb"));
      const onlyTarget = result.items.filter((item) => item.status === "only_target");
      const selection = defaultSelection(result.items);
      expect(onlyTarget.some((item) => selection[item.key])).toBe(false);
      const script = buildSyncScript(result, selection);
      expect(script.statements.some((statement) => /^DROP TABLE/i.test(statement.sql))).toBe(false);
      const { after, expected } = await converge(result, selection);
      expect(openColumns(after)).toEqual(expected);
      expect(openColumns(after, "only_source")).toEqual([]);
      expect(
        after.items
          .filter((item) => item.status === "only_target")
          .map((item) => item.name)
          .sort(),
      ).toEqual(onlyTarget.map((item) => item.name).sort());
    },
    TIMEOUT,
  );

  test(
    "löscht alles, wenn die Quelle leer ist und alles ausgewählt wird",
    async () => {
      await pgReset(["scc", "scd"]);
      await sql(PG, `CREATE SCHEMA scc;\n${pgRich("scd")}`, "sc");
      const result = await compare(pgSide("scc"), pgSide("scd"));
      expect(result.items.every((item) => item.status === "only_target")).toBe(true);
      const { after } = await converge(result);
      expect(open(after)).toEqual([]);
      expect(await catalog(pgSide("scd"))).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "überträgt zwischen Datenbanken und unterschiedlichen Schemanamen",
    async () => {
      await pgReset(["sca"]);
      await sql(PG, pgRich("sca"), "sc");
      await sql(PG, "DROP SCHEMA IF EXISTS app CASCADE; CREATE SCHEMA app;", "sc2");
      const result = await compare(pgSide("sca"), pgSide("app", "sc2", PG_OTHER));
      const { after } = await converge(result);
      expect(open(after)).toEqual([]);
      await sql(PG, "DROP SCHEMA IF EXISTS app2 CASCADE;", "sc2");
      await sql(PG, pgVariant("app2"), "sc2");
      await compare(pgSide("sca"), pgSide("app2", "sc2", PG_OTHER));
      await reverseSchemaCompare();
      const reverse = current();
      expect(reverse.target.database).toBe("sc");
      const back = await converge(reverse);
      expect(openColumns(back.after)).toEqual(back.expected);
    },
    TIMEOUT,
  );

  test(
    "Probelauf stoppt bei neuen Enum-Werten ohne Änderungen, Ausführung schreibt sie vorab fest",
    async () => {
      await pgReset(["sce", "scf"]);
      await sql(
        PG,
        `CREATE SCHEMA sce;
CREATE TYPE sce.state AS ENUM ('new', 'done', 'archived');
CREATE TABLE sce.task (id integer PRIMARY KEY, state sce.state NOT NULL DEFAULT 'archived');
CREATE SCHEMA scf;
CREATE TYPE scf.state AS ENUM ('new', 'done');
CREATE TABLE scf.task (id integer PRIMARY KEY, state scf.state NOT NULL DEFAULT 'new');`,
        "sc",
      );
      const result = await compare(pgSide("sce"), pgSide("scf"));
      const before = await catalog(pgSide("scf"));
      const dry = await apply(result, everything(result), true);
      expect(dry.incomplete).toBe(true);
      expect(await catalog(pgSide("scf"))).toEqual(before);
      await apply(result, everything(result));
      const after = await compare(pgSide("sce"), pgSide("scf"));
      expect(open(after)).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "Probelauf setzt keine Sequenzwerte, Ausführung schon",
    async () => {
      await pgReset(["scg", "sch"]);
      await sql(
        PG,
        `CREATE SCHEMA scg; CREATE SEQUENCE scg.counter INCREMENT 2; SELECT setval('scg.counter', 500);
CREATE SCHEMA sch; CREATE SEQUENCE sch.counter; SELECT setval('sch.counter', 7);`,
        "sc",
      );
      const options = { ignoreSequenceValues: false };
      const result = await compare(pgSide("scg"), pgSide("sch"), options);
      const selection = everything(result);
      expect(buildSyncScript(result, selection).statements.some((s) => /setval/.test(s.sql))).toBe(
        true,
      );
      const before = await catalog(pgSide("sch"));
      const dry = await apply(result, selection, true);
      expect(dry.steps.some((step) => step.status === "warning")).toBe(true);
      expect(await catalog(pgSide("sch"))).toEqual(before);
      await apply(result, selection);
      const after = await compare(pgSide("scg"), pgSide("sch"), options);
      expect(open(after)).toEqual([]);
    },
    TIMEOUT,
  );
});

const oraSide = (schema: string): CompareSide => ({
  connectionId: ORA.id,
  database: null,
  schema,
});

function oraUser(s: string): string {
  return `
BEGIN
  FOR u IN (SELECT username FROM all_users WHERE username = '${s}') LOOP
    EXECUTE IMMEDIATE 'DROP USER ${s} CASCADE';
  END LOOP;
END;
/
CREATE USER ${s} IDENTIFIED BY "Lab_2026" QUOTA UNLIMITED ON USERS;
GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE MATERIALIZED VIEW, CREATE PROCEDURE, CREATE SEQUENCE, CREATE TRIGGER, CREATE TYPE, CREATE SYNONYM TO ${s};
`;
}

function oraRich(s: string): string {
  return `${oraUser(s)}
CREATE TYPE ${s}.T_ADDR AS OBJECT (STREET VARCHAR2(100), ZIP VARCHAR2(10), MEMBER FUNCTION LABEL RETURN VARCHAR2);
/
CREATE TYPE BODY ${s}.T_ADDR AS MEMBER FUNCTION LABEL RETURN VARCHAR2 IS BEGIN RETURN STREET || ' ' || ZIP; END; END;
/
CREATE SEQUENCE ${s}.ORDER_NO START WITH 1000 INCREMENT BY 5 CACHE 20;
CREATE TABLE ${s}.CUSTOMER (
  ID NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT CUSTOMER_PK PRIMARY KEY,
  NAME VARCHAR2(100 CHAR) NOT NULL,
  EMAIL VARCHAR2(200) CONSTRAINT CUSTOMER_EMAIL_UK UNIQUE,
  SCORE NUMBER(5) DEFAULT 0 CONSTRAINT CUSTOMER_SCORE_CK CHECK (SCORE >= 0),
  HOME ${s}.T_ADDR,
  NAME_UPPER VARCHAR2(400 CHAR) GENERATED ALWAYS AS (UPPER(NAME)) VIRTUAL,
  CREATED DATE DEFAULT ON NULL SYSDATE,
  CODE VARCHAR2(20)
);
CREATE TABLE ${s}.ORDERS (
  ID NUMBER CONSTRAINT ORDERS_PK PRIMARY KEY,
  CUSTOMER_ID NUMBER NOT NULL CONSTRAINT ORDERS_CUSTOMER_FK REFERENCES ${s}.CUSTOMER (ID) ON DELETE CASCADE,
  AMOUNT NUMBER(12,2) NOT NULL,
  STATUS VARCHAR2(10) DEFAULT 'NEW',
  CONSTRAINT ORDERS_AMOUNT_CK CHECK (AMOUNT >= 0) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX ${s}.ORDERS_AMOUNT_IX ON ${s}.ORDERS (AMOUNT DESC);
CREATE INDEX ${s}.ORDERS_STATUS_FX ON ${s}.ORDERS (UPPER(STATUS));
CREATE BITMAP INDEX ${s}.ORDERS_STATUS_BX ON ${s}.ORDERS (STATUS);
CREATE TABLE ${s}.KV (K VARCHAR2(50) CONSTRAINT KV_PK PRIMARY KEY, V VARCHAR2(200)) ORGANIZATION INDEX;
CREATE GLOBAL TEMPORARY TABLE ${s}.SCRATCH (ID NUMBER) ON COMMIT PRESERVE ROWS;
CREATE TABLE ${s}.EVENTS (ID NUMBER, AT DATE NOT NULL) PARTITION BY RANGE (AT) (PARTITION P2026 VALUES LESS THAN (DATE '2027-01-01'), PARTITION PMAX VALUES LESS THAN (MAXVALUE));
CREATE VIEW ${s}.BIG_ORDERS AS SELECT o.ID, c.NAME FROM ${s}.ORDERS o JOIN ${s}.CUSTOMER c ON c.ID = o.CUSTOMER_ID WHERE o.AMOUNT > 100;
CREATE VIEW ${s}.BIG_ORDER_NAMES AS SELECT NAME FROM ${s}.BIG_ORDERS;
CREATE MATERIALIZED VIEW ${s}.ORDER_STATS BUILD IMMEDIATE REFRESH COMPLETE ON DEMAND AS SELECT CUSTOMER_ID, SUM(AMOUNT) TOTAL FROM ${s}.ORDERS GROUP BY CUSTOMER_ID;
CREATE FUNCTION ${s}.ORDER_TOTAL(P_CUSTOMER NUMBER) RETURN NUMBER IS V NUMBER; BEGIN SELECT NVL(SUM(AMOUNT), 0) INTO V FROM ${s}.ORDERS WHERE CUSTOMER_ID = P_CUSTOMER; RETURN V; END;
/
CREATE PROCEDURE ${s}.PURGE(P_DAYS NUMBER) IS BEGIN DELETE FROM ${s}.ORDERS WHERE ID < P_DAYS; END;
/
CREATE PACKAGE ${s}.ORDER_API AS FUNCTION TOTAL(P NUMBER) RETURN NUMBER; END ORDER_API;
/
CREATE PACKAGE BODY ${s}.ORDER_API AS FUNCTION TOTAL(P NUMBER) RETURN NUMBER IS BEGIN RETURN ${s}.ORDER_TOTAL(P); END; END ORDER_API;
/
CREATE TRIGGER ${s}.ORDERS_BI BEFORE INSERT ON ${s}.ORDERS FOR EACH ROW BEGIN IF :NEW.ID IS NULL THEN :NEW.ID := ${s}.ORDER_NO.NEXTVAL; END IF; END;
/
CREATE TRIGGER ${s}.ORDERS_BU BEFORE UPDATE ON ${s}.ORDERS FOR EACH ROW BEGIN :NEW.STATUS := UPPER(:NEW.STATUS); END;
/
ALTER TRIGGER ${s}.ORDERS_BU DISABLE;
CREATE SYNONYM ${s}.CUST FOR ${s}.CUSTOMER;
COMMENT ON TABLE ${s}.CUSTOMER IS 'Kunden';
COMMENT ON COLUMN ${s}.CUSTOMER.NAME IS 'Voller Name';
COMMENT ON MATERIALIZED VIEW ${s}.ORDER_STATS IS 'Statistik';
GRANT SELECT ON ${s}.CUSTOMER TO SC_READER;
GRANT SELECT, UPDATE ON ${s}.BIG_ORDERS TO SC_READER;
INSERT INTO ${s}.CUSTOMER (NAME, EMAIL, SCORE) VALUES ('Ada', 'ada@example.com', 5);
INSERT INTO ${s}.ORDERS (CUSTOMER_ID, AMOUNT) VALUES (1, 150);
COMMIT;
`;
}

function oraVariant(s: string): string {
  return `${oraUser(s)}
CREATE TYPE ${s}.T_ADDR AS OBJECT (STREET VARCHAR2(100), ZIP VARCHAR2(10), MEMBER FUNCTION LABEL RETURN VARCHAR2);
/
CREATE TYPE BODY ${s}.T_ADDR AS MEMBER FUNCTION LABEL RETURN VARCHAR2 IS BEGIN RETURN ZIP || ' ' || STREET; END; END;
/
CREATE SEQUENCE ${s}.ORDER_NO START WITH 1000 INCREMENT BY 1 CACHE 20;
CREATE SEQUENCE ${s}.LEGACY_SEQ;
CREATE TABLE ${s}.CUSTOMER (
  ID NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT CUSTOMER_PK PRIMARY KEY,
  NAME VARCHAR2(80 CHAR) NOT NULL,
  EMAIL VARCHAR2(200) CONSTRAINT CUSTOMER_EMAIL_UK UNIQUE,
  SCORE NUMBER(5) DEFAULT 1 CONSTRAINT CUSTOMER_SCORE_CK CHECK (SCORE >= 1),
  HOME ${s}.T_ADDR,
  NAME_UPPER VARCHAR2(400 CHAR) GENERATED ALWAYS AS (UPPER(NAME)) VIRTUAL,
  CREATED DATE DEFAULT ON NULL SYSDATE,
  LEGACY_FLAG NUMBER(1)
);
CREATE TABLE ${s}.ORDERS (
  ID NUMBER CONSTRAINT ORDERS_PK PRIMARY KEY,
  CUSTOMER_ID NUMBER NOT NULL CONSTRAINT ORDERS_CUSTOMER_FK REFERENCES ${s}.CUSTOMER (ID),
  AMOUNT NUMBER(12,2) NOT NULL,
  STATUS VARCHAR2(10) DEFAULT 'NEW',
  CONSTRAINT ORDERS_AMOUNT_CK CHECK (AMOUNT >= 1) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX ${s}.ORDERS_CUSTOMER_IX ON ${s}.ORDERS (CUSTOMER_ID);
CREATE INDEX ${s}.ORDERS_STATUS_FX ON ${s}.ORDERS (UPPER(STATUS));
CREATE TABLE ${s}.LEGACY (ID NUMBER CONSTRAINT LEGACY_PK PRIMARY KEY, CUSTOMER_ID NUMBER CONSTRAINT LEGACY_CUSTOMER_FK REFERENCES ${s}.CUSTOMER (ID));
CREATE TABLE ${s}.EVENTS (ID NUMBER, AT DATE NOT NULL) PARTITION BY RANGE (AT) (PARTITION P2026 VALUES LESS THAN (DATE '2027-01-01'), PARTITION PMAX VALUES LESS THAN (MAXVALUE));
CREATE VIEW ${s}.BIG_ORDERS AS SELECT o.ID, c.NAME FROM ${s}.ORDERS o JOIN ${s}.CUSTOMER c ON c.ID = o.CUSTOMER_ID WHERE o.AMOUNT > 50;
CREATE VIEW ${s}.BIG_ORDER_NAMES AS SELECT NAME FROM ${s}.BIG_ORDERS;
CREATE VIEW ${s}.LEGACY_VIEW AS SELECT ID FROM ${s}.LEGACY;
CREATE MATERIALIZED VIEW ${s}.ORDER_STATS BUILD IMMEDIATE REFRESH COMPLETE ON DEMAND AS SELECT CUSTOMER_ID, SUM(AMOUNT) TOTAL, COUNT(*) ORDERS FROM ${s}.ORDERS GROUP BY CUSTOMER_ID;
CREATE FUNCTION ${s}.ORDER_TOTAL(P_CUSTOMER NUMBER) RETURN NUMBER IS V NUMBER; BEGIN SELECT SUM(AMOUNT) INTO V FROM ${s}.ORDERS WHERE CUSTOMER_ID = P_CUSTOMER; RETURN V; END;
/
CREATE PROCEDURE ${s}.PURGE(P_DAYS NUMBER) IS BEGIN DELETE FROM ${s}.ORDERS WHERE ID < P_DAYS; END;
/
CREATE PROCEDURE ${s}.LEGACY_PROC IS BEGIN NULL; END;
/
CREATE PACKAGE ${s}.ORDER_API AS FUNCTION TOTAL(P NUMBER) RETURN NUMBER; FUNCTION COUNT_ALL RETURN NUMBER; END ORDER_API;
/
CREATE PACKAGE BODY ${s}.ORDER_API AS FUNCTION TOTAL(P NUMBER) RETURN NUMBER IS BEGIN RETURN ${s}.ORDER_TOTAL(P); END; FUNCTION COUNT_ALL RETURN NUMBER IS N NUMBER; BEGIN SELECT COUNT(*) INTO N FROM ${s}.ORDERS; RETURN N; END; END ORDER_API;
/
CREATE TRIGGER ${s}.ORDERS_BI BEFORE INSERT ON ${s}.ORDERS FOR EACH ROW BEGIN IF :NEW.ID IS NULL THEN :NEW.ID := ${s}.ORDER_NO.NEXTVAL; END IF; END;
/
CREATE TRIGGER ${s}.ORDERS_BU BEFORE UPDATE ON ${s}.ORDERS FOR EACH ROW BEGIN :NEW.STATUS := UPPER(:NEW.STATUS); END;
/
CREATE SYNONYM ${s}.LEG FOR ${s}.LEGACY;
COMMENT ON TABLE ${s}.CUSTOMER IS 'Kundenstamm';
COMMENT ON TABLE ${s}.LEGACY IS 'Alt';
GRANT INSERT ON ${s}.CUSTOMER TO SC_READER;
INSERT INTO ${s}.CUSTOMER (NAME, EMAIL) VALUES ('Cleo', 'cleo@example.com');
INSERT INTO ${s}.ORDERS (CUSTOMER_ID, AMOUNT) VALUES (1, 70);
COMMIT;
`;
}

describe.skipIf(!BRIDGE || !ORACLE_URL)("Schema-Vergleich live: Oracle", () => {
  beforeAll(async () => {
    await sql(ORA, oraUser("SC_READER"));
  }, TIMEOUT);

  test(
    "erstellt alle Objekttypen in einem leeren Zielschema",
    async () => {
      await sql(ORA, `${oraRich("SCA")}\n${oraUser("SCC")}`);
      const result = await compare(oraSide("SCA"), oraSide("SCC"));
      expect(result.items.every((item) => item.status === "only_source")).toBe(true);
      const types = new Set(
        result.items.flatMap((item) => [
          item.type,
          ...item.children.map((child) => child.object_type),
        ]),
      );
      expect(compareTypesFor("oracle").filter((type) => !types.has(type))).toEqual([]);
      const { after } = await converge(result, defaultSelection(result.items));
      expect(open(after)).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "gleicht Unterschiede in beide Richtungen an",
    async () => {
      await sql(ORA, `${oraRich("SCA")}\n${oraVariant("SCB")}`);
      const forward = await compare(oraSide("SCA"), oraSide("SCB"));
      const statuses = new Set(forward.items.map((item) => item.status));
      expect([...statuses].sort()).toEqual([
        "different",
        "identical",
        "only_source",
        "only_target",
      ]);
      const { after, expected } = await converge(forward);
      expect(expected).toEqual(["different column CUSTOMER.NAME"]);
      expect(openColumns(after)).toEqual(expected);

      await sql(ORA, oraVariant("SCB"));
      await compare(oraSide("SCA"), oraSide("SCB"));
      await reverseSchemaCompare();
      const reverse = current();
      expect(reverse.targetSchema).toBe("SCA");
      const back = await converge(reverse);
      expect(back.expected).toEqual(["different column CUSTOMER.NAME"]);
      expect(openColumns(back.after)).toEqual(back.expected);
    },
    TIMEOUT,
  );

  test(
    "löscht alles, wenn die Quelle leer ist und alles ausgewählt wird",
    async () => {
      await sql(ORA, `${oraUser("SCC")}\n${oraRich("SCD")}`);
      const result = await compare(oraSide("SCC"), oraSide("SCD"));
      expect(result.items.every((item) => item.status === "only_target")).toBe(true);
      const { after } = await converge(result);
      expect(open(after)).toEqual([]);
      expect(await catalog(oraSide("SCD"))).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "Datenprüfung verhindert die Ausführung bei Datenkonflikten und ändert nichts",
    async () => {
      await sql(
        ORA,
        `${oraUser("SCE")}
CREATE TABLE SCE.PARENT (ID NUMBER CONSTRAINT PARENT_PK PRIMARY KEY);
CREATE TABLE SCE.ITEM (
  ID NUMBER,
  PARENT_ID NUMBER,
  CODE VARCHAR2(20 CHAR),
  QTY NUMBER(10,2),
  NOTE VARCHAR2(50),
  REQUIRED NUMBER NOT NULL,
  CONSTRAINT ITEM_PK PRIMARY KEY (ID),
  CONSTRAINT ITEM_CODE_UK UNIQUE (CODE),
  CONSTRAINT ITEM_PARENT_FK FOREIGN KEY (PARENT_ID) REFERENCES SCE.PARENT (ID),
  CONSTRAINT ITEM_QTY_CK CHECK (QTY >= 0)
);
${oraUser("SCF")}
CREATE TABLE SCF.PARENT (ID NUMBER CONSTRAINT PARENT_PK PRIMARY KEY);
CREATE TABLE SCF.ITEM (ID NUMBER, PARENT_ID NUMBER, CODE VARCHAR2(40 CHAR), QTY NUMBER(12,4), NOTE VARCHAR2(50));
INSERT INTO SCF.PARENT VALUES (1);
INSERT INTO SCF.ITEM VALUES (1, 1, 'lang-genug-fuer-mehr-als-20-zeichen', -1, NULL);
INSERT INTO SCF.ITEM VALUES (1, 9, 'lang-genug-fuer-mehr-als-20-zeichen', 2.5, 'x');
INSERT INTO SCF.ITEM VALUES (NULL, NULL, NULL, NULL, NULL);
COMMIT;`,
      );
      const result = await compare(oraSide("SCE"), oraSide("SCF"));
      const selection = everything(result);
      const before = await catalog(oraSide("SCF"));
      const check = await run(result, selection, true);
      const failed = check.script.statements
        .map((statement, index) => ({ sql: statement.sql, step: check.steps[index] }))
        .filter(({ step }) => step?.status === "error")
        .map(({ sql }) => sql.replace(/"/g, ""));
      expect(failed.sort()).toEqual(
        [
          "ALTER TABLE SCF.ITEM ADD (REQUIRED NUMBER NOT NULL)",
          "ALTER TABLE SCF.ITEM ADD CONSTRAINT ITEM_CODE_UK UNIQUE (CODE)",
          "ALTER TABLE SCF.ITEM ADD CONSTRAINT ITEM_PARENT_FK FOREIGN KEY (PARENT_ID) REFERENCES SCF.PARENT (ID)",
          "ALTER TABLE SCF.ITEM ADD CONSTRAINT ITEM_PK PRIMARY KEY (ID)",
          "ALTER TABLE SCF.ITEM ADD CONSTRAINT ITEM_QTY_CK CHECK (QTY >= 0)",
          "ALTER TABLE SCF.ITEM MODIFY (CODE VARCHAR2(20 CHAR))",
          "ALTER TABLE SCF.ITEM MODIFY (ID NOT NULL)",
          "ALTER TABLE SCF.ITEM MODIFY (QTY NUMBER(10,2))",
        ].sort(),
      );
      expect(check.summary.failed).toBe(failed.length);
      expect(await catalog(oraSide("SCF"))).toEqual(before);
      const real = await run(result, selection, false);
      expect(real.summary.blocked).toBe(true);
      expect(await catalog(oraSide("SCF"))).toEqual(before);

      await sql(ORA, "DELETE FROM SCF.ITEM; COMMIT;");
      const clean = await compare(oraSide("SCE"), oraSide("SCF"));
      const { after } = await converge(clean);
      expect(open(after)).toEqual([]);
    },
    TIMEOUT,
  );
});
