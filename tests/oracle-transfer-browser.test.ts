import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import { openOracleApp, oracleBridge, oracleFailures } from "./fixtures/oracle-browser";

const enabled = Boolean(process.env.L8DB_ORACLE_BROWSER);
const lab = (user: string) => `oracle://${user}:l8dbtest@127.0.0.1:15219/FREEPDB1`;
const shots = "test-artifacts/oracle-ui";
const USERS = ["TR_SRC", "TR_DST", "TR_APP", "TR_OTHER"];
let browser: Browser;

type Rows = Record<string, unknown>[];

async function bridge(command: string, args: Record<string, unknown>, retries = 3) {
  const response = await fetch(oracleBridge, {
    method: "POST",
    body: JSON.stringify({ command, args }),
  });
  const value = await response.json();
  if (value.error !== undefined && retries > 0 && String(value.error).includes("DPI-1080"))
    return bridge(command, args, retries - 1);
  if (value.error !== undefined) throw new Error(`${command}: ${value.error}`);
  return value.result;
}

async function sql(user: string, statement: string): Promise<Rows> {
  const result = await bridge("execute_query", {
    kind: "oracle",
    connectionString: lab(user),
    sql: statement,
    options: { rowLimit: 100000 },
  });
  return result.rows;
}

async function script(user: string, statement: string, retries = 3): Promise<void> {
  const results = await bridge("execute_script", {
    kind: "oracle",
    connectionString: lab(user),
    sql: statement,
  });
  const failed = (results as { success: boolean; error?: string }[]).find((r) => !r.success);
  if (failed && retries > 0 && failed.error?.includes("DPI-1080"))
    return script(user, statement, retries - 1);
  if (failed) throw new Error(`${statement.slice(0, 80)}: ${failed.error}`);
}

async function value(user: string, statement: string) {
  const rows = await sql(user, statement);
  return String(Object.values(rows[0] ?? {})[0] ?? "");
}

const DROP_USERS = `BEGIN
  FOR s IN (SELECT sid, serial# AS serial FROM v$session WHERE username IN (${USERS.map((u) => `'${u}'`).join(", ")})) LOOP
    BEGIN EXECUTE IMMEDIATE 'ALTER SYSTEM KILL SESSION ''' || s.sid || ',' || s.serial || ''' IMMEDIATE'; EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
  FOR u IN (SELECT username FROM dba_users WHERE username IN (${USERS.map((u) => `'${u}'`).join(", ")})) LOOP
    EXECUTE IMMEDIATE 'DROP USER ' || u.username || ' CASCADE';
  END LOOP;
END;`;

async function dropUsers() {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sql("system", DROP_USERS);
    } catch (error) {
      if (attempt > 40 || !String(error).includes("ORA-01940")) throw error;
      await Bun.sleep(250);
    }
  }
}

const PRIVILEGES =
  "CREATE SESSION, CREATE TABLE, CREATE SEQUENCE, CREATE PROCEDURE, CREATE VIEW, CREATE TRIGGER, CREATE TYPE, CREATE SYNONYM, CREATE MATERIALIZED VIEW";

const USERS_SETUP = [
  "CREATE USER tr_src IDENTIFIED BY l8dbtest QUOTA UNLIMITED ON users",
  "CREATE USER tr_dst IDENTIFIED BY l8dbtest QUOTA UNLIMITED ON users",
  "CREATE USER tr_app IDENTIFIED BY l8dbtest",
  "CREATE USER tr_other IDENTIFIED BY l8dbtest QUOTA UNLIMITED ON users",
  `GRANT ${PRIVILEGES} TO tr_src, tr_dst`,
  "GRANT CREATE SESSION TO tr_app",
  "CREATE TABLE tr_other.land (code VARCHAR2(2) PRIMARY KEY, name VARCHAR2(40))",
  "INSERT INTO tr_other.land VALUES ('DE', 'Deutschland')",
  "INSERT INTO tr_other.land VALUES ('AT', 'Österreich')",
  "COMMIT",
  "GRANT SELECT, REFERENCES ON tr_other.land TO tr_src, tr_dst WITH GRANT OPTION",
];

const SOURCE = [
  "CREATE TYPE t_adresse AS OBJECT (strasse VARCHAR2(60), plz VARCHAR2(10), MEMBER FUNCTION zeile RETURN VARCHAR2);",
  "CREATE TYPE BODY t_adresse AS MEMBER FUNCTION zeile RETURN VARCHAR2 IS BEGIN RETURN strasse || ', ' || plz; END; END;",
  "CREATE TYPE t_zahlen AS VARRAY(10) OF NUMBER;",
  "CREATE TYPE t_namen AS TABLE OF VARCHAR2(50);",
  "CREATE SEQUENCE beleg_seq START WITH 500 INCREMENT BY 5 CACHE 20",
  "CREATE SEQUENCE zyklus_seq START WITH 1 INCREMENT BY 1 MAXVALUE 99 CYCLE NOCACHE ORDER",
  `CREATE TABLE kunde (
    id NUMBER GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1) PRIMARY KEY,
    name VARCHAR2(40 CHAR) NOT NULL,
    land VARCHAR2(2) REFERENCES tr_other.land (code),
    saldo NUMBER(14,4) DEFAULT 0,
    angelegt DATE DEFAULT SYSDATE NOT NULL,
    geheim VARCHAR2(10) INVISIBLE,
    brutto NUMBER GENERATED ALWAYS AS (saldo * 1.19) VIRTUAL,
    CONSTRAINT kunde_name_uk UNIQUE (name) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT kunde_saldo_ck CHECK (saldo >= -1000000))`,
  "COMMENT ON TABLE kunde IS 'Kunden''s Tabelle'",
  "COMMENT ON COLUMN kunde.name IS 'Name des Kunden'",
  "CREATE INDEX kunde_upper_ix ON kunde (UPPER(name), saldo DESC)",
  "CREATE BITMAP INDEX kunde_land_bx ON kunde (land)",
  `CREATE TABLE auftrag (
    id NUMBER DEFAULT tr_src.beleg_seq.NEXTVAL,
    pos NUMBER(5) NOT NULL,
    kunde_id NUMBER NOT NULL,
    betrag NUMBER(12,2),
    status VARCHAR2(10) DEFAULT 'NEU',
    CONSTRAINT auftrag_pk PRIMARY KEY (id, pos),
    CONSTRAINT auftrag_kunde_fk FOREIGN KEY (kunde_id) REFERENCES "TR_SRC".kunde (id) ON DELETE CASCADE,
    CONSTRAINT auftrag_status_ck CHECK (status IN ('NEU', 'BEZAHLT', 'STORNO')) DISABLE,
    CONSTRAINT auftrag_betrag_ck CHECK (betrag < 1000000) ENABLE NOVALIDATE)`,
  "CREATE INDEX auftrag_kunde_ix ON auftrag (kunde_id) REVERSE",
  "CREATE UNIQUE INDEX auftrag_unique_ix ON auftrag (kunde_id, id, pos) INVISIBLE",
  `CREATE TABLE "Baum" ("Id" NUMBER PRIMARY KEY, "Eltern" NUMBER REFERENCES "Baum" ("Id") ON DELETE SET NULL, "Name" VARCHAR2(30))`,
  "CREATE GLOBAL TEMPORARY TABLE puffer (id NUMBER, wert VARCHAR2(20)) ON COMMIT PRESERVE ROWS",
  "CREATE TABLE schluessel (k VARCHAR2(10) PRIMARY KEY, v NUMBER) ORGANIZATION INDEX",
  `CREATE TABLE protokoll (id NUMBER, tag DATE NOT NULL, text VARCHAR2(100))
    PARTITION BY RANGE (tag) INTERVAL (NUMTOYMINTERVAL(1, 'MONTH'))
    (PARTITION p0 VALUES LESS THAN (DATE '2024-01-01'))`,
  "CREATE INDEX protokoll_tag_ix ON protokoll (tag) LOCAL",
  "CREATE TABLE verkauf (id NUMBER PRIMARY KEY, region VARCHAR2(10), menge NUMBER) PARTITION BY HASH (id) PARTITIONS 4",
  `CREATE TABLE typen (
    id NUMBER PRIMARY KEY,
    n_plain NUMBER, n_38 NUMBER(38), n_scale NUMBER(12,4), n_neg NUMBER(*, -2), n_float FLOAT(126),
    b_float BINARY_FLOAT, b_double BINARY_DOUBLE,
    v_text VARCHAR2(4000), v_n NVARCHAR2(100), c_fix CHAR(10), c_n NCHAR(5),
    l_clob CLOB, l_nclob NCLOB, l_blob BLOB, r_raw RAW(16),
    d_date DATE, t_ts TIMESTAMP(9), t_tz TIMESTAMP(6) WITH TIME ZONE, t_ltz TIMESTAMP WITH LOCAL TIME ZONE,
    i_ym INTERVAL YEAR(3) TO MONTH, i_ds INTERVAL DAY(5) TO SECOND(9),
    x_xml XMLTYPE, j_json JSON, f_bool BOOLEAN, u_rowid UROWID)`,
  "CREATE TABLE langtext (id NUMBER PRIMARY KEY, inhalt LONG)",
  "CREATE TABLE langroh (id NUMBER PRIMARY KEY, inhalt LONG RAW)",
  "CREATE TABLE adressen (id NUMBER PRIMARY KEY, adresse t_adresse, zahlen t_zahlen, namen t_namen) NESTED TABLE namen STORE AS adressen_namen_nt",
  "CREATE MATERIALIZED VIEW LOG ON kunde WITH PRIMARY KEY, ROWID",
  `INSERT INTO kunde (name, land, saldo, angelegt, geheim)
    SELECT 'Kunde ' || LEVEL, CASE MOD(LEVEL, 3) WHEN 0 THEN 'DE' WHEN 1 THEN 'AT' END,
           LEVEL * 1.2345, DATE '2024-01-01' + LEVEL, 'g' || LEVEL
    FROM dual CONNECT BY LEVEL <= 300`,
  `INSERT INTO auftrag (pos, kunde_id, betrag, status)
    SELECT MOD(LEVEL, 7) + 1, MOD(LEVEL, 300) + 1, LEVEL / 7, CASE MOD(LEVEL, 2) WHEN 0 THEN 'NEU' ELSE 'XYZ' END
    FROM dual CONNECT BY LEVEL <= 2500`,
  `INSERT INTO "Baum" VALUES (1, NULL, 'Wurzel')`,
  `INSERT INTO "Baum" VALUES (2, 1, 'Ast')`,
  `INSERT INTO "Baum" VALUES (3, 2, 'Blatt')`,
  "INSERT INTO schluessel SELECT 'K' || LEVEL, LEVEL FROM dual CONNECT BY LEVEL <= 50",
  "INSERT INTO protokoll SELECT LEVEL, DATE '2023-12-15' + LEVEL, 'Eintrag ' || LEVEL FROM dual CONNECT BY LEVEL <= 120",
  "INSERT INTO verkauf SELECT LEVEL, 'R' || MOD(LEVEL, 5), LEVEL * 3 FROM dual CONNECT BY LEVEL <= 1000",
  "INSERT INTO typen (id) VALUES (0)",
  `INSERT INTO typen VALUES (
    1, 123456789012345678901234567890.123456789, 12345678901234567890123456789012345678, -98765432.1234, 123456700,
    1.5e-130, 3.4028235e38f, 1.7976931348623157e308d,
    RPAD('ä', 4000, 'ö'), N'Grüße 🌍 日本語', 'abc', N'äöü',
    TO_CLOB(RPAD('x', 32000, 'yz')) || TO_CLOB(RPAD('€', 32000, 'ü')) || TO_CLOB(RPAD('q', 32000, 'r')),
    TO_NCLOB(N'NCLOB 🌍 ' || RPAD('ß', 20000, 'ẞ')),
    TO_BLOB(UTL_RAW.CAST_TO_RAW(RPAD('B', 2000, 'L'))), HEXTORAW('00FF10AB00FF10AB00FF10AB00FF10AB'),
    TO_DATE('9999-12-31 23:59:59', 'YYYY-MM-DD HH24:MI:SS'), TIMESTAMP '2024-02-29 13:14:15.123456789',
    TIMESTAMP '2024-10-27 02:30:00.123456 Europe/Berlin', TIMESTAMP '2024-06-01 12:00:00 +05:30',
    INTERVAL '123-11' YEAR(3) TO MONTH, INTERVAL '12345 23:59:59.123456789' DAY(5) TO SECOND(9),
    XMLTYPE('<a x="1"><b>Text &amp; mehr</b><c/></a>'), JSON('{"a":[1,2,{"b":null}],"c":"ü"}'), TRUE, NULL)`,
  `INSERT INTO typen (id, b_float, b_double, d_date, l_clob, l_blob, v_text, f_bool, n_plain) VALUES (
    2, BINARY_FLOAT_NAN, BINARY_DOUBLE_INFINITY, TO_DATE('-4712-01-01', 'SYYYY-MM-DD'), EMPTY_CLOB(), EMPTY_BLOB(), ' ', FALSE, -0.000000000000000000000000000000000001)`,
  "INSERT INTO typen (id, b_double, n_plain, t_tz) VALUES (3, -BINARY_DOUBLE_INFINITY, 9.99999999999999999999999999999999999999e125, TIMESTAMP '2000-01-01 00:00:00 -11:00')",
  "INSERT INTO typen (id, t_tz) VALUES (6, TO_TIMESTAMP_TZ('2024-10-27 02:30:00.5 Europe/Berlin CEST', 'YYYY-MM-DD HH24:MI:SS.FF TZR TZD'))",
  `DECLARE
    big BLOB;
  BEGIN
    DBMS_LOB.CREATETEMPORARY(big, TRUE);
    FOR i IN 1 .. 64 LOOP
      DBMS_LOB.APPEND(big, UTL_RAW.CAST_TO_RAW(RPAD(TO_CHAR(i), 4000, CHR(65 + MOD(i, 26)))));
    END LOOP;
    INSERT INTO typen (id, l_blob) VALUES (4, big);
  END;`,
  "INSERT INTO typen (id, u_rowid) SELECT 5, ROWID FROM schluessel WHERE k = 'K1'",
  "INSERT INTO langtext VALUES (1, RPAD('L', 3000, 'x') || 'Ende')",
  "INSERT INTO langtext VALUES (2, NULL)",
  "INSERT INTO langroh VALUES (1, HEXTORAW('DEADBEEF00'))",
  "INSERT INTO adressen VALUES (1, t_adresse('Hauptstr. 1', '10115'), t_zahlen(1, 2.5, NULL), t_namen('a', 'b'))",
  "INSERT INTO adressen VALUES (2, NULL, NULL, NULL)",
  "INSERT INTO adressen VALUES (3, t_adresse(NULL, '1'), t_zahlen(), t_namen())",
  "COMMIT",
  `CREATE MATERIALIZED VIEW mv_umsatz BUILD IMMEDIATE REFRESH COMPLETE ON DEMAND AS
    SELECT k.land, COUNT(*) anzahl, SUM(a.betrag) summe FROM tr_src.kunde k JOIN auftrag a ON a.kunde_id = k.id GROUP BY k.land`,
  "COMMENT ON MATERIALIZED VIEW mv_umsatz IS 'Umsatz je Land'",
  `CREATE OR REPLACE FUNCTION f_anzahl(p_id NUMBER) RETURN NUMBER AS
    v NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v FROM tr_src.auftrag WHERE kunde_id = p_id;
    RETURN v;
  END;`,
  `CREATE OR REPLACE PROCEDURE p_neu(p_name VARCHAR2) IS
  BEGIN
    INSERT INTO "TR_SRC".kunde (name) VALUES (p_name);
  END p_neu;`,
  `CREATE OR REPLACE PACKAGE konto AS
    zaehler NUMBER := 0;
    FUNCTION saldo_von(p_id NUMBER) RETURN NUMBER;
    PROCEDURE log_text(p_text VARCHAR2);
  END konto;`,
  `CREATE OR REPLACE PACKAGE BODY konto AS
    FUNCTION saldo_von(p_id NUMBER) RETURN NUMBER IS
      v NUMBER;
    BEGIN
      zaehler := zaehler + 1;
      SELECT saldo INTO v FROM tr_src.kunde WHERE id = p_id;
      RETURN v;
    END;
    PROCEDURE log_text(p_text VARCHAR2) IS
    BEGIN
      INSERT INTO protokoll (id, tag, text) VALUES (-1, SYSDATE, 'tr_src.kunde: ' || p_text);
    END;
  END konto;`,
  `CREATE OR REPLACE VIEW v_kunde (kunden_id, kunden_name, anzahl, land_name) AS
    SELECT k.id, k.name, f_anzahl(k.id), l.name FROM tr_src.kunde k LEFT JOIN tr_other.land l ON l.code = k.land`,
  "CREATE OR REPLACE VIEW v_gross AS SELECT * FROM tr_src.auftrag WHERE betrag > 100 WITH CHECK OPTION",
  "CREATE OR REPLACE VIEW v_kette AS SELECT kunden_id, anzahl FROM v_kunde WHERE anzahl > 5 WITH READ ONLY",
  `CREATE OR REPLACE TRIGGER auftrag_bi BEFORE INSERT ON auftrag FOR EACH ROW
  BEGIN
    :new.status := UPPER(NVL(:new.status, 'NEU'));
    :new.betrag := NVL(:new.betrag, 0) + 1;
  END;`,
  `CREATE OR REPLACE TRIGGER kunde_au AFTER UPDATE ON kunde FOR EACH ROW
  BEGIN
    konto.log_text(:new.name);
  END;`,
  "ALTER TRIGGER kunde_au DISABLE",
  `CREATE OR REPLACE TRIGGER v_kunde_io INSTEAD OF INSERT ON v_kunde FOR EACH ROW
  BEGIN
    p_neu(:new.kunden_name);
  END;`,
  "CREATE SYNONYM kunden FOR kunde",
  "CREATE SYNONYM laender FOR tr_other.land",
  "GRANT SELECT ON kunde TO tr_app",
  "GRANT EXECUTE ON konto TO tr_app WITH GRANT OPTION",
  "GRANT SELECT ON v_kunde TO tr_app",
];

function normalize(text: unknown) {
  return String(text ?? "")
    .toUpperCase()
    .replaceAll("TR_SRC", "TR_DST")
    .replaceAll('"', "")
    .replaceAll("TR_DST.", "")
    .replace(/ISEQ\$\$_\d+/g, "ISEQ$$")
    .replace(/SYS_C\d+/g, "SYS_C")
    .replace(/SYS_FK\d+N\d+\$/g, "SYS_FK$")
    .replace(/\s+/g, " ")
    .trim();
}

const STRUCTURE: Record<string, (owner: string) => string> = {
  objects: (o) =>
    `SELECT object_type, object_name, CASE WHEN object_type <> 'MATERIALIZED VIEW' THEN status END FROM dba_objects WHERE owner = '${o}'
     AND object_type NOT IN ('INDEX', 'LOB', 'INDEX PARTITION', 'TABLE PARTITION', 'LOB PARTITION')
     AND object_name NOT LIKE 'SYS\\_%' ESCAPE '\\' AND object_name NOT LIKE 'ISEQ$$%'`,
  tables: (o) =>
    `SELECT table_name, iot_type, temporary, duration, partitioned, nested FROM dba_tables WHERE owner = '${o}' AND table_name NOT LIKE 'SYS\\_%' ESCAPE '\\'`,
  partitions: (o) =>
    `SELECT table_name, partitioning_type, subpartitioning_type, partition_count, interval FROM dba_part_tables WHERE owner = '${o}'`,
  columns: (o) =>
    `SELECT table_name, column_name, data_type, data_type_owner, data_length, data_precision, data_scale, nullable, char_used,
            char_length, virtual_column, hidden_column, identity_column, default_on_null, data_default_vc
     FROM dba_tab_cols WHERE owner = '${o}' AND user_generated = 'YES' AND table_name NOT LIKE 'BIN$%'`,
  identity: (o) =>
    `SELECT table_name, column_name, generation_type FROM dba_tab_identity_cols WHERE owner = '${o}'`,
  constraints: (o) =>
    `SELECT c.table_name, c.constraint_type, DECODE(c.generated, 'GENERATED NAME', '#', c.constraint_name), c.status, c.deferrable,
            c.deferred, c.validated, c.search_condition_vc, c.delete_rule, r.owner || '.' || r.table_name,
            (SELECT LISTAGG(column_name, ',') WITHIN GROUP (ORDER BY position) FROM dba_cons_columns x
              WHERE x.owner = c.owner AND x.constraint_name = c.constraint_name)
     FROM dba_constraints c LEFT JOIN dba_constraints r ON r.owner = c.r_owner AND r.constraint_name = c.r_constraint_name
     WHERE c.owner = '${o}' AND c.table_name NOT LIKE 'BIN$%' AND c.constraint_type <> '?'`,
  indexes: (o) =>
    `SELECT i.table_name, DECODE(i.generated, 'Y', '#', i.index_name), i.index_type, i.uniqueness, i.visibility, i.partitioned,
            p.locality, (SELECT LISTAGG(column_name || ' ' || descend, ',') WITHIN GROUP (ORDER BY column_position)
              FROM dba_ind_columns x WHERE x.index_owner = i.owner AND x.index_name = i.index_name)
     FROM dba_indexes i LEFT JOIN dba_part_indexes p ON p.owner = i.owner AND p.index_name = i.index_name
     WHERE i.owner = '${o}' AND i.index_type <> 'LOB'`,
  expressions: (o) =>
    `SELECT table_name, column_position, column_expression FROM dba_ind_expressions WHERE index_owner = '${o}'`,
  source: (o) => `SELECT type, name, line, text FROM dba_source WHERE owner = '${o}'`,
  views: (o) => `SELECT view_name, text_vc, read_only FROM dba_views WHERE owner = '${o}'`,
  mviews: (o) =>
    `SELECT mview_name, refresh_mode, refresh_method, build_mode, rewrite_enabled FROM dba_mviews WHERE owner = '${o}'`,
  mviewLogs: (o) =>
    `SELECT master, log_table, rowids, primary_key, object_id, sequence, include_new_values FROM dba_mview_logs WHERE log_owner = '${o}'`,
  sequences: (o) =>
    `SELECT sequence_name, min_value, max_value, increment_by, cycle_flag, order_flag, cache_size FROM dba_sequences
     WHERE sequence_owner = '${o}' AND sequence_name NOT LIKE 'ISEQ$$%'`,
  synonyms: (o) =>
    `SELECT synonym_name, table_owner, table_name, db_link FROM dba_synonyms WHERE owner = '${o}'`,
  grants: (o) =>
    `SELECT grantee, table_name, privilege, grantable, hierarchy FROM dba_tab_privs WHERE owner = '${o}'`,
  comments: (o) =>
    `SELECT table_name, table_type, comments FROM dba_tab_comments WHERE owner = '${o}' AND comments IS NOT NULL
     UNION ALL SELECT table_name, column_name, comments FROM dba_col_comments WHERE owner = '${o}' AND comments IS NOT NULL
     UNION ALL SELECT mview_name, 'MVIEW', comments FROM dba_mview_comments WHERE owner = '${o}' AND comments IS NOT NULL`,
  triggers: (o) =>
    `SELECT trigger_name, trigger_type, triggering_event, base_object_type, table_name, status, action_type FROM dba_triggers WHERE owner = '${o}'`,
  types: (o) =>
    `SELECT t.type_name, t.typecode, t.attributes, t.methods, c.coll_type, c.upper_bound, c.elem_type_name
     FROM dba_types t LEFT JOIN dba_coll_types c ON c.owner = t.owner AND c.type_name = t.type_name WHERE t.owner = '${o}'`,
  typeAttributes: (o) =>
    `SELECT type_name, attr_name, attr_type_name, length, precision, scale, attr_no FROM dba_type_attrs WHERE owner = '${o}'`,
};

async function structure(owner: string) {
  const out: Record<string, string[]> = {};
  for (const [name, query] of Object.entries(STRUCTURE)) {
    const rows = await sql("system", query(owner));
    const lines = rows.map((row) => normalize(Object.values(row).join(" | ")));
    if (name === "source") {
      const bodies = new Map<string, string>();
      for (const row of rows) {
        const key = `${row.TYPE} ${row.NAME}`;
        bodies.set(key, `${bodies.get(key) ?? ""} ${row.TEXT ?? ""}`);
      }
      out[name] = [...bodies].map(([key, text]) => normalize(`${key}: ${text}`)).sort();
    } else out[name] = lines.sort();
  }
  return out;
}

function comparable(alias: string, column: string, type: string, owner: string | null) {
  const c = `${alias}."${column}"`;
  if (["CLOB", "NCLOB", "BLOB"].includes(type)) return { lob: c };
  if (type === "XMLTYPE") return { lob: `XMLSERIALIZE(CONTENT ${c} AS CLOB)` };
  if (type === "JSON") return { lob: `JSON_SERIALIZE(${c} RETURNING CLOB)` };
  if (owner && owner !== "SYS") return { lob: `XMLSERIALIZE(CONTENT SYS_XMLGEN(${c}) AS CLOB)` };
  if (type.includes("WITH TIME ZONE") && !type.includes("LOCAL"))
    return { scalar: `TO_CHAR(${c}, 'SYYYY-MM-DD HH24:MI:SS.FF9 TZR TZD')` };
  return { scalar: c };
}

async function differences() {
  const columns = await sql(
    "system",
    `SELECT c.table_name, c.column_name, c.data_type, c.data_type_owner,
            (SELECT LISTAGG(k.column_name, ',') FROM dba_cons_columns k JOIN dba_constraints p
               ON p.owner = k.owner AND p.constraint_name = k.constraint_name
             WHERE p.owner = c.owner AND p.table_name = c.table_name AND p.constraint_type = 'P') AS pk
     FROM dba_tab_cols c JOIN dba_tables t ON t.owner = c.owner AND t.table_name = c.table_name
     WHERE c.owner = 'TR_SRC' AND c.user_generated = 'YES' AND t.temporary = 'N' AND t.nested = 'NO'
       AND t.table_name NOT LIKE 'MLOG$%' AND c.data_type NOT IN ('LONG', 'LONG RAW')
     ORDER BY c.table_name, c.column_id`,
  );
  const tables = new Map<string, { pk: string; columns: Rows }>();
  for (const row of columns) {
    const name = String(row.TABLE_NAME);
    const entry = tables.get(name) ?? { pk: String(row.PK ?? ""), columns: [] };
    entry.columns.push(row);
    tables.set(name, entry);
  }
  const report: Record<string, number> = {};
  for (const [table, { pk, columns: cols }] of tables) {
    const keys = pk ? pk.split(",") : [];
    const target = `"TR_DST"."${table}"`;
    const source = `"TR_SRC"."${table}"`;
    let statement: string;
    if (keys.length) {
      const join = keys.map((k) => `s."${k}" = d."${k}"`).join(" AND ");
      const checks = cols.map((col) => {
        const left = comparable(
          "s",
          String(col.COLUMN_NAME),
          String(col.DATA_TYPE),
          col.DATA_TYPE_OWNER as string | null,
        );
        const right = comparable(
          "d",
          String(col.COLUMN_NAME),
          String(col.DATA_TYPE),
          col.DATA_TYPE_OWNER as string | null,
        );
        return left.lob
          ? `((${left.lob}) IS NULL AND (${right.lob}) IS NULL OR DBMS_LOB.COMPARE(${left.lob}, ${right.lob}) = 0)`
          : `(${left.scalar} = ${right.scalar} OR ${left.scalar} IS NULL AND ${right.scalar} IS NULL)`;
      });
      statement = `SELECT COUNT(*) AS n FROM ${source} s FULL OUTER JOIN ${target} d ON ${join}
        WHERE s."${keys[0]}" IS NULL OR d."${keys[0]}" IS NULL OR NOT (${checks.join(" AND ")})`;
    } else {
      const list = (alias: string) =>
        cols
          .map(
            (col) => comparable(alias, String(col.COLUMN_NAME), String(col.DATA_TYPE), null).scalar,
          )
          .join(", ");
      statement = `SELECT (SELECT COUNT(*) FROM (SELECT ${list("s")} FROM ${source} s MINUS SELECT ${list("d")} FROM ${target} d))
        + (SELECT COUNT(*) FROM (SELECT ${list("d")} FROM ${target} d MINUS SELECT ${list("s")} FROM ${source} s))
        + ABS((SELECT COUNT(*) FROM ${source}) - (SELECT COUNT(*) FROM ${target})) AS n FROM dual`;
    }
    report[table] = Number(await value("system", statement));
  }
  for (const table of ["LANGTEXT", "LANGROH"]) {
    const read = (owner: string) =>
      sql(owner.toLowerCase(), `SELECT id, inhalt FROM ${table} ORDER BY id`);
    report[table] =
      JSON.stringify(await read("TR_SRC")) === JSON.stringify(await read("TR_DST")) ? 0 : 1;
  }
  return report;
}

async function expectIdentical() {
  const [source, target] = [await structure("TR_SRC"), await structure("TR_DST")];
  expect(target).toEqual(source);
  const diff = await differences();
  expect(Object.keys(diff).sort()).toEqual([
    "ADRESSEN",
    "AUFTRAG",
    "Baum",
    "KUNDE",
    "LANGROH",
    "LANGTEXT",
    "MV_UMSATZ",
    "PROTOKOLL",
    "SCHLUESSEL",
    "TYPEN",
    "VERKAUF",
  ]);
  expect(Object.entries(diff).filter(([, n]) => n !== 0)).toEqual([]);
}

async function expectWorking() {
  const max = Number(await value("tr_dst", "SELECT MAX(id) FROM kunde"));
  await script("tr_dst", "INSERT INTO kunde (name) VALUES ('Neu nach Transfer')");
  expect(Number(await value("tr_dst", "SELECT MAX(id) FROM kunde"))).toBe(max + 1);
  await expect(script("tr_dst", "INSERT INTO kunde (id, name) VALUES (9999, 'x')")).rejects.toThrow(
    "ORA-32795",
  );
  const sequence = Number(await value("tr_dst", "SELECT beleg_seq.NEXTVAL FROM dual"));
  const sourceLast = Number(
    await value(
      "system",
      "SELECT last_number FROM dba_sequences WHERE sequence_owner = 'TR_SRC' AND sequence_name = 'BELEG_SEQ'",
    ),
  );
  expect(sequence).toBeGreaterThanOrEqual(sourceLast);
  await script("tr_dst", "INSERT INTO auftrag (id, pos, kunde_id, betrag) VALUES (-5, 1, 1, 10)");
  await script("tr_dst", "COMMIT");
  expect(await value("tr_dst", "SELECT TO_CHAR(betrag) FROM auftrag WHERE id = -5")).toBe("11");
  expect(await value("tr_dst", "SELECT TO_CHAR(konto.saldo_von(7)) FROM dual")).toBe(
    await value("tr_src", "SELECT TO_CHAR(konto.saldo_von(7)) FROM dual"),
  );
  expect(await value("tr_dst", "SELECT a.adresse.zeile() FROM adressen a WHERE id = 1")).toBe(
    "Hauptstr. 1, 10115",
  );
  await script("tr_dst", "BEGIN DBMS_MVIEW.REFRESH('MV_UMSATZ'); END;");
  expect(Number(await value("tr_dst", "SELECT SUM(anzahl) FROM mv_umsatz"))).toBe(2501);
  expect(await value("tr_app", "SELECT COUNT(*) FROM tr_dst.kunde")).toBe(
    await value("tr_dst", "SELECT COUNT(*) FROM kunde"),
  );
  expect(await value("tr_dst", "SELECT COUNT(*) FROM user_objects WHERE status <> 'VALID'")).toBe(
    "0",
  );
}

async function withPage(name: string, run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  try {
    await run(page);
  } catch (error) {
    await page.screenshot({ path: `${shots}/${name}-failure.png` });
    console.error(JSON.stringify(await oracleFailures(page)));
    throw error;
  } finally {
    await page.close();
  }
}

async function openTransfer(page: Page, onSource?: () => Promise<void>) {
  await page.addInitScript(() => {
    if (localStorage.getItem("l8db.connections")) return;
    localStorage.setItem(
      "l8db.settings",
      JSON.stringify({ state: { tourFinished: true, onboardingDone: true }, version: 0 }),
    );
    localStorage.setItem(
      "l8db.connections",
      JSON.stringify({
        state: {
          connections: [
            {
              id: "oracle-lab",
              name: "TR Quelle",
              kind: "oracle",
              connectionString: "oracle://tr_src@127.0.0.1:15219/FREEPDB1",
              sslMode: "disable",
              ssh: null,
            },
            {
              id: "oracle-debug",
              name: "TR Ziel",
              kind: "oracle",
              connectionString: "oracle://tr_dst@127.0.0.1:15219/FREEPDB1",
              sslMode: "disable",
              ssh: null,
            },
          ],
          activeId: "oracle-lab",
        },
        version: 0,
      }),
    );
  });
  await openOracleApp(page, "/transfer");
  const source = page.getByRole("combobox", { name: "Quelle: Verbindung" });
  if (!(await source.innerText()).includes("TR Quelle")) {
    await source.click();
    await page.getByRole("option", { name: "TR Quelle" }).click();
  }
  await onSource?.();
  await page.getByRole("combobox", { name: "Ziel: Verbindung" }).click();
  await page.getByRole("option", { name: "TR Ziel" }).click();
  await page.getByRole("textbox", { name: "Schemas filtern" }).fill("TR_SRC");
  await page.locator("#transfer-schema-TR_SRC").click();
  await page.getByLabel("Zielschema für TR_SRC").fill("TR_DST");
}

async function startAndWait(page: Page) {
  await page.getByRole("button", { name: "Übertragung starten" }).click();
  await page.getByRole("dialog", { name: "Transfer läuft" }).waitFor();
  await page
    .getByText(/Zeilen in \d+ Tabellen übertragen und verifiziert|Transfer fehlgeschlagen/)
    .first()
    .waitFor({ timeout: 600_000 });
  const failure = page.getByText("Transfer fehlgeschlagen");
  if (await failure.count()) throw new Error(await page.locator("pre").first().innerText());
}

beforeAll(async () => {
  if (!enabled) return;
  await dropUsers();
  for (const statement of USERS_SETUP) await script("system", statement);
  for (const statement of SOURCE) await script("tr_src", statement);
  await sql("tr_src", "SELECT beleg_seq.NEXTVAL FROM dual CONNECT BY LEVEL <= 3");
  await sql("tr_src", "SELECT zyklus_seq.NEXTVAL FROM dual CONNECT BY LEVEL <= 7");
  browser = await chromium.launch();
}, 600_000);

afterAll(async () => {
  if (!enabled) return;
  await browser?.close();
  await dropUsers();
}, 120_000);

async function pickTables(page: Page, tables: string[]) {
  await page.getByRole("button", { name: "Tabellen aus TR_SRC" }).click();
  const popover = page.locator('[data-slot="popover-content"]');
  const list = popover.getByRole("group", { name: "Objekte aus TR_SRC" });
  await list.waitFor();
  await popover.getByRole("button", { name: "Keine" }).click();
  for (const table of tables) {
    await popover.getByRole("textbox", { name: "Objekte filtern" }).fill(table);
    await list.locator(`[data-table="${table}"]`).click();
  }
  await page.keyboard.press("Escape");
}

async function pickContent(page: Page, label: string) {
  await page.getByRole("combobox", { name: "Umfang" }).click();
  await page.getByRole("option", { name: label }).click();
}

async function finish(page: Page, done: RegExp) {
  await page.getByRole("button", { name: "Übertragung starten" }).click();
  await page.getByRole("dialog", { name: "Transfer läuft" }).waitFor();
  const outcome = page.getByText(new RegExp(`${done.source}|Transfer fehlgeschlagen`)).first();
  await outcome.waitFor({ timeout: 600_000 });
  if (await page.getByText("Transfer fehlgeschlagen").count())
    throw new Error(await page.locator("pre").first().innerText());
  await page.getByRole("dialog", { name: "Transfer läuft" }).waitFor({ state: "hidden" });
}

const CLEAR_TARGET = `BEGIN
  FOR l IN (SELECT master FROM dba_mview_logs WHERE log_owner = 'TR_DST') LOOP
    EXECUTE IMMEDIATE 'DROP MATERIALIZED VIEW LOG ON TR_DST."' || l.master || '"';
  END LOOP;
  FOR o IN (SELECT object_name, object_type FROM dba_objects WHERE owner = 'TR_DST'
            AND object_type IN ('TABLE', 'SEQUENCE', 'PACKAGE') AND object_name NOT LIKE 'ISEQ$$%'
            ORDER BY object_type DESC) LOOP
    EXECUTE IMMEDIATE 'DROP ' || o.object_type || ' TR_DST."' || o.object_name || '"'
      || CASE WHEN o.object_type = 'TABLE' THEN ' CASCADE CONSTRAINTS PURGE' END;
  END LOOP;
END;`;

test.skipIf(!enabled)(
  "Oracle → Oracle copies chosen tables as structure first and loads their data afterwards",
  async () => {
    try {
      await withPage("transfer-scope", async (page) => {
        await openTransfer(page);
        await page.getByText(/\d+ Tabellen bereit/).waitFor({ timeout: 120_000 });
        await pickTables(page, ["AUFTRAG", "KUNDE"]);
        expect(await page.getByRole("button", { name: "Tabellen aus TR_SRC" }).innerText()).toMatch(
          /^2 von \d+/,
        );
        await pickContent(page, "Nur Struktur");
        await page.getByText("2 Tabellen bereit, nur Struktur").waitFor({ timeout: 120_000 });
        expect(await page.getByText("Ziel vollständig überschreiben").count()).toBe(0);
        await finish(page, /Struktur von 2 Tabellen angelegt/);

        const objects = await sql(
          "system",
          "SELECT object_type || ' ' || object_name AS o FROM dba_objects WHERE owner = 'TR_DST' AND object_name NOT LIKE 'ISEQ$$%' AND object_name NOT LIKE 'SYS_%' ORDER BY 1",
        );
        expect(objects.map((row) => row.O)).toEqual([
          "INDEX AUFTRAG_KUNDE_IX",
          "INDEX AUFTRAG_PK",
          "INDEX AUFTRAG_UNIQUE_IX",
          "INDEX I_MLOG$_KUNDE",
          "INDEX KUNDE_LAND_BX",
          "INDEX KUNDE_NAME_UK",
          "INDEX KUNDE_UPPER_IX",
          "PACKAGE BODY KONTO",
          "PACKAGE KONTO",
          "SEQUENCE BELEG_SEQ",
          "TABLE AUFTRAG",
          "TABLE KUNDE",
          "TABLE MLOG$_KUNDE",
          "TRIGGER AUFTRAG_BI",
          "TRIGGER KUNDE_AU",
        ]);
        expect(await value("system", "SELECT COUNT(*) FROM tr_dst.auftrag")).toBe("0");
        expect(
          await value(
            "system",
            "SELECT COUNT(*) FROM dba_constraints WHERE owner = 'TR_DST' AND constraint_type = 'R'",
          ),
        ).toBe("2");

        await pickContent(page, "Nur Daten");
        await page.getByText("2 Tabellen bereit, nur Daten").waitFor({ timeout: 120_000 });
        await finish(page, /Zeilen in 2 Tabellen übertragen und verifiziert/);
        for (const [table, columns] of [
          ["kunde", "id || name || land || saldo || angelegt || geheim"],
          ["auftrag", "id || pos || kunde_id || betrag || status"],
        ]) {
          const digest = (owner: string) =>
            value(
              "system",
              `SELECT COUNT(*) || '/' || SUM(ORA_HASH(${columns})) FROM ${owner}.${table}`,
            );
          expect(await digest("tr_dst")).toBe(await digest("tr_src"));
        }
        expect(
          await value(
            "system",
            "SELECT generation_type FROM dba_tab_identity_cols WHERE owner = 'TR_DST' AND table_name = 'KUNDE'",
          ),
        ).toBe("ALWAYS");
        expect(
          (
            await sql(
              "system",
              "SELECT trigger_name || ' ' || status AS t FROM dba_triggers WHERE owner = 'TR_DST' ORDER BY 1",
            )
          ).map((row) => row.T),
        ).toEqual(["AUFTRAG_BI ENABLED", "KUNDE_AU DISABLED"]);

        await page.getByRole("button", { name: "Übertragung starten" }).waitFor();
        await pickContent(page, "Struktur und Daten");
        await page.getByText(/Objekte im Ziel bereits vorhanden/).waitFor({ timeout: 120_000 });
      });
    } finally {
      await sql("system", CLEAR_TARGET);
    }
  },
  900_000,
);

test.skipIf(!enabled)(
  "Oracle → Oracle copies every object, every value and keeps it usable",
  async () => {
    const overview = (await bridge("get_database_overview", {
      kind: "oracle",
      connectionString: lab("tr_src"),
      database: null,
    })) as { schemas: { schema: string; size_bytes: number }[] };
    expect(overview.schemas.find((s) => s.schema === "TR_SRC")?.size_bytes).toBeGreaterThan(0);
    await withPage("transfer-copy", async (page) => {
      await openTransfer(page);
      await page.getByText(/\d+ Tabellen bereit/).waitFor({ timeout: 120_000 });
      expect(await page.getByText("Ziel vollständig überschreiben").count()).toBe(1);
      await startAndWait(page);
    });
    await expectIdentical();
    await expectWorking();
  },
  900_000,
);

test.skipIf(!enabled)(
  "Overwriting replaces the whole target schema after typed confirmation",
  async () => {
    await script("tr_dst", "CREATE TABLE fremd (id NUMBER)");
    await script("tr_dst", "CREATE OR REPLACE VIEW v_kunde AS SELECT 1 AS x FROM dual");
    await script("tr_dst", "DELETE FROM auftrag WHERE MOD(id, 2) = 0");
    await script("tr_dst", "COMMIT");
    await script("tr_src", "INSERT INTO kunde (name) VALUES ('Nach dem ersten Transfer')");
    await script("tr_src", "COMMIT");
    await script(
      "tr_src",
      "CREATE OR REPLACE PROCEDURE p_spaeter IS BEGIN konto.log_text('x'); END;",
    );
    await withPage("transfer-replace", async (page) => {
      await openTransfer(page);
      await page.getByText(/Objekte im Ziel bereits vorhanden/).waitFor({ timeout: 120_000 });
      await page.getByRole("switch", { name: "Ziel vollständig überschreiben" }).click();
      await page
        .getByText(/Tabellen bereit, Ziel wird überschrieben/)
        .waitFor({ timeout: 120_000 });
      expect(await page.getByText("TABLE TR_DST.FREMD").count()).toBe(1);
      await page.getByRole("button", { name: "Übertragung starten" }).click();
      const dialog = page.getByRole("alertdialog");
      const confirm = dialog.getByRole("button", { name: "Überschreiben" });
      expect(await confirm.isDisabled()).toBe(true);
      await dialog.getByRole("textbox").fill("TR_DST");
      await confirm.click();
      await page
        .getByText(/Zeilen in \d+ Tabellen übertragen und verifiziert|Transfer fehlgeschlagen/)
        .first()
        .waitFor({ timeout: 600_000 });
      if (await page.getByText("Transfer fehlgeschlagen").count())
        throw new Error(await page.locator("pre").first().innerText());
    });
    expect(
      await value(
        "system",
        "SELECT COUNT(*) FROM dba_objects WHERE owner = 'TR_DST' AND object_name = 'FREMD'",
      ),
    ).toBe("0");
    await script("tr_dst", "BEGIN DBMS_SESSION.RESET_PACKAGE; END;");
    await expectIdentical();
    await expectWorking();
  },
  900_000,
);

test.skipIf(!enabled)(
  "Overwriting refuses unsafe targets and objects added after planning",
  async () => {
    const source = { kind: "oracle", connectionString: lab("tr_src"), database: null };
    const plan = (target: string) =>
      bridge("plan_transfer", {
        kind: "oracle",
        connectionString: lab("tr_dst"),
        database: null,
        request: {
          source,
          schemas: [{ source: "TR_SRC", target }],
          foldNames: true,
          replace: true,
          mirror: true,
        },
      });
    const count = (owner: string) =>
      value("system", `SELECT COUNT(*) FROM dba_objects WHERE owner = '${owner}'`);
    const before = await count("TR_SRC");
    await expect(plan("TR_SRC")).rejects.toThrow("würde beim Überschreiben gelöscht");
    await expect(plan("SYSTEM")).rejects.toThrow("wird von Oracle verwaltet");
    expect(await count("TR_SRC")).toBe(before);

    await script("tr_dst", "GRANT REFERENCES ON kunde TO tr_other");
    await script(
      "system",
      "CREATE TABLE tr_other.bestellung (kunde_id NUMBER CONSTRAINT bestellung_kunde_fk REFERENCES tr_dst.kunde (id))",
    );
    await script("system", "GRANT SELECT ON tr_other.bestellung TO tr_dst");
    await expect(plan("TR_DST")).rejects.toThrow(
      "TR_OTHER.BESTELLUNG (Fremdschlüssel BESTELLUNG_KUNDE_FK)",
    );
    await script("system", "DROP TABLE tr_other.bestellung PURGE");

    const confirmed = await plan("TR_DST");
    const targetBefore = await count("TR_DST");
    await script("tr_dst", "CREATE TABLE nachzuegler (id NUMBER)");
    const outcome = bridge("run_transfer", {
      kind: "oracle",
      connectionString: lab("tr_dst"),
      database: null,
      request: { source, plan: confirmed },
      options: { jobId: "oracle-transfer-unconfirmed" },
    });
    await expect(outcome).rejects.toThrow("TABLE TR_DST.NACHZUEGLER");
    expect(Number(await count("TR_DST"))).toBe(Number(targetBefore) + 1);
    await script("tr_dst", "DROP TABLE nachzuegler PURGE");
  },
  120_000,
);

test.skipIf(!enabled)(
  "A failed overwrite removes everything it created and reports it",
  async () => {
    const source = { kind: "oracle", connectionString: lab("tr_src"), database: null };
    const plan = await bridge("plan_transfer", {
      kind: "oracle",
      connectionString: lab("tr_dst"),
      database: null,
      request: {
        source,
        schemas: [{ source: "TR_SRC", target: "TR_DST" }],
        foldNames: true,
        replace: true,
        mirror: true,
      },
    });
    expect(plan.replace).toBe(true);
    expect(plan.replaced.length).toBeGreaterThan(20);
    expect(plan.conflicts).toEqual([]);
    plan.preData = [
      {
        sql: "CREATE TABLE TR_DST.KUNDE (ID NUMBER)",
        objectType: "table",
        schema: "TR_DST",
        name: "KUNDE",
      },
    ];
    plan.postData = [{ sql: "CREATE INDEX TR_DST.KAPUTT ON TR_DST.GIBTSNICHT (X)" }];
    plan.tables = plan.tables.filter((t: { sourceName: string }) => t.sourceName === "KUNDE");
    plan.tables[0].columns = plan.tables[0].columns.filter(
      (c: { source: string }) => c.source === "ID",
    );
    plan.beforeLoad = [];
    plan.finalize = [];
    plan.sequences = [];
    const outcome = await bridge("run_transfer", {
      kind: "oracle",
      connectionString: lab("tr_dst"),
      database: null,
      request: { source, plan },
      options: { jobId: "oracle-transfer-failure" },
    });
    expect(outcome.committed).toBe(false);
    expect(outcome.error).toContain("GIBTSNICHT");
    expect(outcome.rolledBack).toBe(true);
    expect(outcome.leftovers).toEqual([]);
    expect(
      await value(
        "system",
        "SELECT COUNT(*) FROM dba_objects WHERE owner = 'TR_DST' AND object_name NOT LIKE 'SYS\\_%' ESCAPE '\\'",
      ),
    ).toBe("0");
  },
);

test.skipIf(!enabled)(
  "Transfer focuses the target, shows progress, lists code objects and opens the script",
  async () => {
    await withPage("transfer-acceptance", async (page) => {
      await openTransfer(page, async () => {
        const target = page.getByRole("combobox", { name: "Ziel: Verbindung" });
        await expect
          .poll(() => target.evaluate((node) => node === document.activeElement))
          .toBe(true);
        await page.screenshot({ path: `${shots}/abnahme-1-ziel-autofokus.png` });
      });
      await page
        .getByRole("status")
        .filter({ hasText: /Plan wird erstellt|Struktur von/ })
        .waitFor();
      await page.screenshot({ path: `${shots}/abnahme-2-laden.png` });
      await page.getByText(/\d+ Tabellen bereit/).waitFor({ timeout: 120_000 });
      expect(await page.getByRole("columnheader", { name: "Zielschema" }).count()).toBe(1);
      expect(await page.getByRole("columnheader", { name: "Ziel", exact: true }).count()).toBe(0);
      await page.screenshot({ path: `${shots}/abnahme-3-zielschema.png` });

      await page.getByRole("button", { name: "Tabellen aus TR_SRC" }).click();
      const popover = page.locator('[data-slot="popover-content"]');
      const list = popover.getByRole("group", { name: "Objekte aus TR_SRC" });
      await list.waitFor();
      await popover.getByText("Packages", { exact: true }).waitFor();
      await page.screenshot({ path: `${shots}/abnahme-4-objekte.png` });
      await popover.getByRole("textbox", { name: "Objekte filtern" }).fill("KUNDE_AU");
      await list.locator('[data-object="trigger:KUNDE.KUNDE_AU"]').click();
      await page.keyboard.press("Escape");
      await page.getByText(/\d+ Tabellen bereit/).waitFor({ timeout: 120_000 });

      await page.getByRole("button", { name: "Skript anzeigen" }).click();
      const dialog = page.getByRole("dialog", { name: "Übertragungsplan" });
      await dialog.waitFor();
      expect((await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(1300);
      const text = await dialog.locator("pre").first().innerText();
      expect(text).toContain("AUFTRAG_BI");
      expect(text).not.toContain("KUNDE_AU");
      await page.screenshot({ path: `${shots}/abnahme-5-plan.png` });

      await dialog.getByRole("button", { name: "Im Editor öffnen" }).click();
      await page.waitForURL(/\/query\//);
      await page.locator(".monaco-editor .view-lines").first().waitFor();
      await expect
        .poll(() => page.locator(".monaco-editor .view-lines").first().innerText())
        .toContain("CREATE");
      await page.screenshot({ path: `${shots}/abnahme-6-editor.png` });
    });
  },
  300_000,
);

test.skipIf(!enabled)(
  "Oracle → Oracle between two users that only own their schema maps the target automatically",
  async () => {
    await script("system", CLEAR_TARGET);
    await withPage("transfer-own-schema", async (page) => {
      await openTransfer(page);
      const mapping = page.getByLabel("Zielschema für TR_SRC");
      await mapping.fill("");
      expect(await mapping.getAttribute("placeholder")).toBe("TR_DST");
      await pickContent(page, "Nur Struktur");
      await page.getByText(/\d+ Tabellen bereit, nur Struktur/).waitFor({ timeout: 120_000 });
      await page.getByRole("textbox", { name: "Schemas filtern" }).fill("");
      await page.screenshot({ path: `${shots}/abnahme-7-eigenes-schema.png` });
      await finish(page, /Struktur von \d+ Tabellen angelegt/);
      await page.screenshot({ path: `${shots}/abnahme-8-eigenes-schema-fertig.png` });
    });
    const copied = await sql(
      "system",
      "SELECT table_name AS t FROM dba_tables WHERE owner = 'TR_DST' ORDER BY 1",
    );
    expect(copied.map((row) => row.T)).toContain("AUFTRAG");
    expect(copied.map((row) => row.T)).toContain("KUNDE");
  },
  600_000,
);
