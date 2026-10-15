import type { CompareObjectType } from "@/lib/compare-types";
import type { SavedConnection } from "@/lib/connections";
import { executeQuery } from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";
import { METADATA_QUERY } from "./session";

export const FINGERPRINT_PAGE = 1000;
export const FINGERPRINT_VERSION = 1;

export interface ObjectFingerprint {
  value: string;
  fresh: boolean;
}

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

export const fingerprintKey = (
  kind: string,
  type: CompareObjectType | string,
  name: string,
): string =>
  `${type}\u0000${
    kind !== "postgres" && (type === "routine" || type === "procedure")
      ? name.replace(/\(.*$/s, "")
      : name
  }`;

const postgresName: Partial<Record<CompareObjectType, string>> = {
  table: "c.relname::text",
  view: "c.relname::text",
  materialized_view: "c.relname::text",
  sequence: "c.relname::text",
  routine: "p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'",
  procedure: "p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'",
};

function postgresSql(type: CompareObjectType, schema: string, after: string | null) {
  const name = postgresName[type];
  if (!name) return null;
  const page = `${after === null ? "" : ` AND (${name}) COLLATE "C" > ${literal(after)} COLLATE "C"`} ORDER BY (${name}) COLLATE "C" LIMIT ${FINGERPRINT_PAGE}`;
  const namespace = `JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ${literal(schema)}`;
  switch (type) {
    case "table":
      return `SELECT ${name} AS "name", md5(format('%s|%s|%s|%s|%s|%s', c.relkind, obj_description(c.oid, 'pg_class'), (SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s:%s:%s', a.attnum, a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attidentity, a.attgenerated, a.attcollation, pg_catalog.pg_get_expr(d.adbin, d.adrelid), col_description(c.oid, a.attnum)), ',' ORDER BY a.attnum) FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped), (SELECT string_agg(format('%s:%s:%s:%s:%s', o.conname, pg_catalog.pg_get_constraintdef(o.oid), o.convalidated, o.condeferrable, o.condeferred), ',' ORDER BY o.conname) FROM pg_catalog.pg_constraint o WHERE o.conrelid = c.oid), (SELECT string_agg(format('%s:%s:%s', pg_catalog.pg_get_indexdef(i.indexrelid), i.indisprimary, i.indisunique), ',' ORDER BY pg_catalog.pg_get_indexdef(i.indexrelid)) FROM pg_catalog.pg_index i WHERE i.indrelid = c.oid), (SELECT string_agg(format('%s:%s:%s', t.tgname, pg_catalog.pg_get_triggerdef(t.oid), t.tgenabled), ',' ORDER BY t.tgname) FROM pg_catalog.pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal))) AS "fp" FROM pg_catalog.pg_class c ${namespace} AND c.relkind IN ('r', 'p', 'f')${page}`;
    case "view":
    case "materialized_view":
      return `SELECT ${name} AS "name", md5(format('%s|%s|%s|%s', pg_catalog.pg_get_viewdef(c.oid), c.reloptions, obj_description(c.oid, 'pg_class'), (SELECT string_agg(pg_catalog.pg_get_indexdef(i.indexrelid), ',' ORDER BY pg_catalog.pg_get_indexdef(i.indexrelid)) FROM pg_catalog.pg_index i WHERE i.indrelid = c.oid))) AS "fp" FROM pg_catalog.pg_class c ${namespace} AND c.relkind = '${type === "view" ? "v" : "m"}'${page}`;
    case "sequence":
      return `SELECT ${name} AS "name", md5(format('%s|%s|%s|%s|%s|%s|%s|%s', pg_catalog.format_type(s.seqtypid, NULL), s.seqstart, s.seqincrement, s.seqmax, s.seqmin, s.seqcache, s.seqcycle, (SELECT format('%s.%s', d.refobjid::regclass, d.refobjsubid) FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('a', 'i') LIMIT 1))) AS "fp" FROM pg_catalog.pg_class c JOIN pg_catalog.pg_sequence s ON s.seqrelid = c.oid ${namespace} AND c.relkind = 'S'${page}`;
    default:
      return `SELECT ${name} AS "name", md5(format('%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s', p.prosrc, p.probin, pg_catalog.pg_get_function_arguments(p.oid), pg_catalog.pg_get_function_result(p.oid), l.lanname, p.provolatile, p.proisstrict, p.prosecdef, p.proleakproof, p.proparallel, p.procost, p.prorows, p.proconfig, p.prokind, obj_description(p.oid, 'pg_proc'))) AS "fp" FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ${literal(schema)} AND p.prokind ${type === "procedure" ? "= 'p'" : "<> 'p'"}${page}`;
  }
}

const ORACLE_TYPES: Partial<Record<CompareObjectType, string>> = {
  view: "'VIEW'",
  materialized_view: "'MATERIALIZED VIEW'",
  routine: "'FUNCTION'",
  procedure: "'PROCEDURE'",
  package: "'PACKAGE', 'PACKAGE BODY'",
  sequence: "'SEQUENCE'",
};

const ORACLE_TIME = "'YYYYMMDDHH24MISS'";

function oracleSql(type: CompareObjectType, schema: string, after: string | null) {
  const owner = literal(schema);
  const page = `${after === null ? "" : ` AND o.object_name > ${literal(after)}`}`;
  const limit = ` ORDER BY o.object_name FETCH FIRST ${FINGERPRINT_PAGE} ROWS ONLY`;
  if (type === "table")
    return `SELECT o.object_name AS "name", TO_CHAR(o.last_ddl_time, ${ORACLE_TIME}) || ':' || o.status || ':' || NVL(i.cnt, 0) || ':' || TO_CHAR(i.ddl, ${ORACLE_TIME}) || ':' || NVL(g.cnt, 0) || ':' || TO_CHAR(g.ddl, ${ORACLE_TIME}) || ':' || NVL(cm.h, 0) || ':' || NVL(tc.h, 0) AS "fp", CASE WHEN GREATEST(o.last_ddl_time, NVL(i.ddl, o.last_ddl_time), NVL(g.ddl, o.last_ddl_time)) > SYSDATE - 3 / 86400 THEN 1 ELSE 0 END AS "fresh" FROM all_objects o LEFT JOIN (SELECT ix.table_name, COUNT(*) AS cnt, MAX(x.last_ddl_time) AS ddl FROM all_indexes ix JOIN all_objects x ON x.owner = ix.owner AND x.object_name = ix.index_name AND x.object_type = 'INDEX' WHERE ix.table_owner = ${owner} GROUP BY ix.table_name) i ON i.table_name = o.object_name LEFT JOIN (SELECT tr.table_name, COUNT(*) AS cnt, MAX(x.last_ddl_time) AS ddl FROM all_triggers tr JOIN all_objects x ON x.owner = tr.owner AND x.object_name = tr.trigger_name AND x.object_type = 'TRIGGER' WHERE tr.table_owner = ${owner} GROUP BY tr.table_name) g ON g.table_name = o.object_name LEFT JOIN (SELECT c.table_name, SUM(ORA_HASH(c.column_name || ':' || c.comments)) AS h FROM all_col_comments c WHERE c.owner = ${owner} AND c.comments IS NOT NULL GROUP BY c.table_name) cm ON cm.table_name = o.object_name LEFT JOIN (SELECT t.table_name, ORA_HASH(t.comments) AS h FROM all_tab_comments t WHERE t.owner = ${owner} AND t.comments IS NOT NULL) tc ON tc.table_name = o.object_name WHERE o.owner = ${owner} AND o.object_type = 'TABLE'${page}${limit}`;
  const types = ORACLE_TYPES[type];
  if (!types) return null;
  return `SELECT o.object_name AS "name", LISTAGG(o.object_type || '=' || TO_CHAR(o.last_ddl_time, ${ORACLE_TIME}) || '/' || o.status, ';') WITHIN GROUP (ORDER BY o.object_type) AS "fp", MAX(CASE WHEN o.last_ddl_time > SYSDATE - 3 / 86400 THEN 1 ELSE 0 END) AS "fresh" FROM all_objects o WHERE o.owner = ${owner} AND o.object_type IN (${types})${page} GROUP BY o.object_name${limit}`;
}

export function fingerprintSql(
  kind: string,
  type: CompareObjectType,
  schema: string,
  after: string | null,
): string | null {
  if (kind === "postgres") return postgresSql(type, schema, after);
  if (kind === "oracle") return oracleSql(type, schema, after);
  return null;
}

export const supportsFingerprints = (kind: string) => kind === "postgres" || kind === "oracle";

export async function loadFingerprints(
  connection: SavedConnection,
  database: string | null,
  schema: string,
  types: CompareObjectType[],
  signal?: AbortSignal,
): Promise<Map<string, ObjectFingerprint> | null> {
  if (!supportsFingerprints(connection.kind)) return null;
  const result = new Map<string, ObjectFingerprint>();
  const url = effectiveConnectionString(connection);
  try {
    for (const type of types) {
      let after: string | null = null;
      for (;;) {
        signal?.throwIfAborted();
        const sql = fingerprintSql(connection.kind, type, schema, after);
        if (!sql) break;
        const { rows } = await executeQuery(
          connection.kind,
          url,
          sql,
          database ?? undefined,
          METADATA_QUERY,
        );
        for (const row of rows) {
          const name = String(row.name);
          result.set(fingerprintKey(connection.kind, type, name), {
            value: String(row.fp ?? ""),
            fresh: Number(row.fresh ?? 0) === 1,
          });
        }
        if (rows.length < FINGERPRINT_PAGE) break;
        after = String(rows[rows.length - 1].name);
      }
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
  return result;
}
