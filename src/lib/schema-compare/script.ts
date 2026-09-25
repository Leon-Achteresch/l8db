import type { CatalogObject, CatalogObjectType, DatabaseKind } from "@/lib/db";
import { CONTAINER_TYPES, quoteName } from "./diff";
import { addColumnCheck, columnChecks, type DataCheck, keyCheck } from "./precheck";
import type { CompareResult, DiffItem } from "./types";
import { OBJECT_TYPE_META } from "./types";

export interface SyncStatement {
  key: string;
  sql: string;
  plsql: boolean;
  dangerous: boolean;
  phase: number;
  checks?: DataCheck[];
}

export interface SyncScript {
  statements: SyncStatement[];
  warnings: string[];
}

const PLSQL_TYPES = new Set<CatalogObjectType>([
  "function",
  "procedure",
  "package",
  "package_body",
  "type",
  "type_body",
  "trigger",
]);

const VIEW_TYPES = new Set<CatalogObjectType>(["view", "materialized_view"]);

const DROP_PHASE: Partial<Record<CatalogObjectType, number>> = {
  trigger: 0,
  comment: 0.5,
  grant: 0.5,
  view: 2,
  materialized_view: 2,
  package_body: 3,
  type_body: 3,
  function: 3,
  procedure: 3,
  synonym: 3,
  package: 3.5,
  constraint: 4,
  index: 4,
  column: 5,
  table: 6,
  sequence: 7,
  type: 7.5,
};

const CREATE_PHASE: Partial<Record<CatalogObjectType, number>> = {
  type: 10,
  sequence: 11,
  table: 12,
  column: 13,
  constraint: 14,
  view: 17,
  materialized_view: 17,
  index: 19,
  synonym: 19.5,
  package: 20,
  function: 20.5,
  procedure: 20.5,
  package_body: 21,
  type_body: 21,
  trigger: 22,
  comment: 24,
  grant: 25,
};

export const PRE_TRANSACTION_PHASE = -1;
const FK_DROP_PHASE = 1;
const FK_CREATE_PHASE = 16;
const POSTGRES_ROUTINE_PHASE = 11.5;
const POSTGRES_ROUTINE_DROP_PHASE = 6.5;
const SEQUENCE_OWNER_PHASE = 13.5;
const SORTED_TYPES = new Set<CatalogObjectType>(["view", "materialized_view", "type"]);

function routineHeader(ddl: string): string {
  return ddl.split(/\n(?:AS |BEGIN ATOMIC|RETURN )/)[0];
}

function referencesColumn(expression: string, column: string, kind?: DatabaseKind): boolean {
  const name = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    expression.includes(quoteName(column, kind)) ||
    new RegExp(`(^|[^\\w$#"\`[])${name}(?![\\w$#])`, "i").test(expression)
  );
}

function isForeignKey(object: CatalogObject): boolean {
  return object.object_type === "constraint" && object.attributes.kind === "R";
}

function label(object: CatalogObject): string {
  const name =
    object.parent && object.parent !== object.name
      ? `${object.parent}.${object.name}`
      : object.name;
  return `${OBJECT_TYPE_META[object.object_type].label} ${name}`;
}

interface Dependency {
  name: string;
  body: string;
}

function mentions(sql: string, name: string, kind?: DatabaseKind): boolean {
  const pattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `\\.\\s*(?:${pattern(quoteName(name, kind))}|${pattern(name)}(?![\\w$#]))`,
    "i",
  ).test(sql);
}

function sortByDependencies(
  statements: SyncStatement[],
  dependencies: Map<SyncStatement, Dependency>,
  kind: DatabaseKind,
) {
  const pending = [...statements];
  const ordered: SyncStatement[] = [];
  while (pending.length > 0) {
    const index = pending.findIndex((statement) =>
      pending.every((other) => {
        const name = dependencies.get(other)?.name;
        const body = dependencies.get(statement)?.body ?? statement.sql;
        return other === statement || !name || !mentions(body, name, kind);
      }),
    );
    ordered.push(...pending.splice(index < 0 ? 0 : index, 1));
  }
  return ordered;
}

function unicodeText(value: string): string {
  return `N'${value.replace(/'/g, "''")}'`;
}

function sqliteAddable(column: CatalogObject): boolean {
  const attributes = column.attributes;
  const fallback = attributes.default?.trim() ?? "";
  return (
    !attributes.generated?.endsWith("STORED") &&
    !/\b(?:PRIMARY|UNIQUE|REFERENCES|CHECK)\b/i.test(column.ddl) &&
    (attributes.nullable !== "NO" || (fallback !== "" && fallback.toUpperCase() !== "NULL")) &&
    !fallback.startsWith("(") &&
    !/^CURRENT_/i.test(fallback)
  );
}

export function buildSyncScript(
  result: CompareResult,
  selected: Readonly<Record<string, boolean>>,
): SyncScript {
  const kind = result.kind;
  const oracle = kind === "oracle";
  const postgres = kind === "postgres";
  const mysql = kind === "mysql";
  const mssql = kind === "mssql";
  const sqlite = kind === "sqlite";
  const q = (name: string) => quoteName(name, kind);
  const schema = result.targetSchema;
  const qualified = (name: string) => `${q(schema)}.${q(name)}`;
  const statements: SyncStatement[] = [];
  const dependencies = new Map<SyncStatement, Dependency>();
  const warnings: string[] = [];
  const seen = new Set<string>();
  let key = "";
  const relations = (status: DiffItem["status"]) =>
    result.items.filter(
      (item) =>
        selected[item.key] &&
        item.status === status &&
        (item.type === "table" || VIEW_TYPES.has(item.type)),
    );
  const createdRelations = relations("only_source");
  const droppedRelations = relations("only_target");
  const materializedViews = new Set(
    result.items.filter((item) => item.type === "materialized_view").map((item) => item.name),
  );
  const existingTables = new Set(
    result.items
      .filter((item) => item.type === "table" && item.target && item.status !== "only_source")
      .map((item) => item.name),
  );
  const targetPrefix = `${q(schema)}.`;
  const referenceExists = (name: string) =>
    !name.startsWith(targetPrefix) ||
    existingTables.has(name.slice(targetPrefix.length + 1, -1).replace(/""/g, '"'));

  const emit = (
    phase: number,
    sql: string,
    options: {
      plsql?: boolean;
      dangerous?: boolean;
      name?: string;
      body?: string;
      checks?: (DataCheck | null)[];
      repeat?: boolean;
    } = {},
  ) => {
    const text = options.plsql ? sql.trim() : sql.trim().replace(/;\s*$/, "");
    if (!text || (!options.repeat && seen.has(text))) return;
    seen.add(text);
    const checks = oracle
      ? (options.checks ?? []).filter((check): check is DataCheck => Boolean(check))
      : [];
    const statement: SyncStatement = {
      key,
      sql: text,
      plsql: Boolean(options.plsql),
      dangerous: Boolean(options.dangerous),
      phase,
      ...(checks.length > 0 ? { checks } : {}),
    };
    statements.push(statement);
    if (options.name)
      dependencies.set(statement, { name: options.name, body: options.body ?? text });
  };

  const compound = (type: CatalogObjectType) =>
    (oracle && PLSQL_TYPES.has(type)) ||
    (mysql && (type === "function" || type === "procedure" || type === "trigger")) ||
    (mssql &&
      (type === "function" || type === "procedure" || type === "trigger" || type === "view"));

  const triggerStatus = (object: CatalogObject, enable: boolean) =>
    oracle
      ? `ALTER TRIGGER ${qualified(object.name)} ${enable ? "ENABLE" : "DISABLE"}`
      : `ALTER TABLE ${qualified(object.parent ?? "")} ${enable ? "ENABLE" : "DISABLE"} TRIGGER ${q(object.name)}`;

  const dropDefault = (table: string, column: string, phase: number) => {
    const target = unicodeText(qualified(table));
    emit(
      phase,
      `DECLARE @l8db_default sysname = (SELECT d.name FROM sys.default_constraints d WHERE d.parent_object_id = OBJECT_ID(${target}) AND d.parent_column_id = COLUMNPROPERTY(OBJECT_ID(${target}), ${unicodeText(column)}, 'ColumnId')); DECLARE @l8db_sql nvarchar(max) = N'ALTER TABLE ${qualified(table).replace(/'/g, "''")} DROP CONSTRAINT ' + QUOTENAME(@l8db_default); IF @l8db_default IS NOT NULL EXEC(@l8db_sql)`,
      { repeat: true },
    );
  };

  const create = (object: CatalogObject, children: CatalogObject[] = []) => {
    const type = object.object_type;
    const plsql = compound(type);
    if (type === "column") {
      const attributes = object.attributes;
      if (
        attributes.nullable === "NO" &&
        !attributes.default &&
        !attributes.identity &&
        !attributes.virtual &&
        !attributes.generated
      )
        warnings.push(
          `${label(object)}: NOT NULL ohne Default schlägt fehl, wenn die Zieltabelle bereits Zeilen enthält.`,
        );
      const table = qualified(object.parent ?? "");
      emit(
        CREATE_PHASE.column ?? 13,
        oracle
          ? `ALTER TABLE ${table} ADD (${object.ddl})`
          : mssql
            ? `ALTER TABLE ${table} ADD ${object.ddl}`
            : `ALTER TABLE ${table} ADD COLUMN ${object.ddl}`,
        {
          checks: [existingTables.has(object.parent ?? "") ? addColumnCheck(object, table) : null],
        },
      );
      return;
    }
    let phase = CREATE_PHASE[type] ?? 30;
    if (isForeignKey(object)) phase = FK_CREATE_PHASE;
    if (type === "table" && object.attributes.partition_of) phase += 0.5;
    if (postgres && (type === "function" || type === "procedure")) {
      const header = routineHeader(object.ddl);
      phase = Math.max(
        POSTGRES_ROUTINE_PHASE,
        ...createdRelations
          .filter((item) => mentions(header, item.name, kind))
          .map((item) => (CREATE_PHASE[item.type] ?? 12) + 0.5),
      );
    }
    if (
      type === "index" &&
      ((postgres &&
        /^CREATE UNIQUE INDEX/i.test(object.ddl) &&
        !materializedViews.has(object.parent ?? "")) ||
        mysql ||
        (mssql && /^CREATE UNIQUE /i.test(object.ddl)))
    )
      phase = FK_CREATE_PHASE - 0.5;
    if (
      type === "table" &&
      object.attributes.organization === "INDEX" &&
      !/ORGANIZATION INDEX/i.test(object.ddl)
    )
      warnings.push(
        `${label(object)} ist index-organisiert (IOT) und wird als normale Tabelle angelegt.`,
      );
    if (
      type === "table" &&
      object.attributes.partitioned === "YES" &&
      !/PARTITION BY/i.test(object.ddl)
    )
      warnings.push(
        `${label(object)} ist partitioniert; die Partitionierung konnte nicht gelesen werden und wird nicht übernommen.`,
      );
    const keyed =
      (type === "constraint" || type === "index") && existingTables.has(object.parent ?? "");
    emit(phase, object.ddl, {
      plsql,
      name: SORTED_TYPES.has(type) ? object.name : undefined,
      checks: keyed
        ? [
            keyCheck(
              object.attributes.definition ?? "",
              qualified(object.parent ?? ""),
              referenceExists,
            ),
          ]
        : [],
    });
    if (postgres && type === "sequence" && object.parent && object.attributes.owned_column)
      emit(
        SEQUENCE_OWNER_PHASE,
        `ALTER SEQUENCE ${qualified(object.name)} OWNED BY ${qualified(object.parent)}.${q(object.attributes.owned_column)}`,
      );
    if (type === "trigger" && object.attributes.status === "DISABLED")
      emit(phase + 0.1, triggerStatus(object, false));
    if (mssql && type === "constraint" && object.attributes.status === "DISABLED")
      emit(
        phase + 0.1,
        `ALTER TABLE ${qualified(object.parent ?? "")} NOCHECK CONSTRAINT ${q(object.name)}`,
      );
    const inlineKey =
      /ORGANIZATION INDEX/i.test(object.ddl) || (mysql && /\bPRIMARY KEY\b/.test(object.ddl));
    for (const child of children)
      if (
        child.object_type !== "column" &&
        !(inlineKey && child.attributes.kind === "P") &&
        !(sqlite && type === "table" && child.object_type === "constraint")
      )
        create(child);
  };

  const drop = (object: CatalogObject, children: CatalogObject[] = []) => {
    const type = object.object_type;
    let phase = isForeignKey(object) ? FK_DROP_PHASE : (DROP_PHASE[type] ?? 30);
    if (postgres && (type === "function" || type === "procedure")) {
      const header = routineHeader(object.ddl);
      phase = Math.min(
        POSTGRES_ROUTINE_DROP_PHASE,
        ...droppedRelations
          .filter((item) => mentions(header, item.name, kind))
          .map((item) => (DROP_PHASE[item.type] ?? 6) - 0.1),
      );
    }
    if (type === "table" && object.attributes.partition_of) phase -= 0.5;
    const target = qualified(object.name);
    const parent = qualified(object.parent ?? "");
    switch (type) {
      case "table": {
        for (const child of children)
          if ((isForeignKey(child) && !sqlite) || child.object_type === "trigger") drop(child);
        const partitions = result.items.filter(
          (item) =>
            item.type === "table" &&
            !selected[item.key] &&
            mentions(item.target?.attributes.partition_of ?? "", object.name, kind),
        );
        if (partitions.length > 0)
          warnings.push(
            `${label(object)}: Löschen entfernt auch die nicht ausgewählten Partitionen ${partitions.map((item) => item.name).join(", ")}.`,
          );
        emit(phase, `DROP TABLE ${target}`, { dangerous: true });
        return;
      }
      case "column":
        if (mssql && object.attributes.default)
          dropDefault(object.parent ?? "", object.name, phase - 0.1);
        emit(phase, `ALTER TABLE ${parent} DROP COLUMN ${q(object.name)}`, {
          dangerous: true,
        });
        return;
      case "constraint": {
        let clause = `DROP CONSTRAINT ${q(object.name)}`;
        if (mysql && object.attributes.kind === "P") clause = "DROP PRIMARY KEY";
        if (mysql && object.attributes.kind === "R") clause = `DROP FOREIGN KEY ${q(object.name)}`;
        if (mysql && object.attributes.kind === "U") clause = `DROP INDEX ${q(object.name)}`;
        emit(phase, `ALTER TABLE ${parent} ${clause}`, { dangerous: true });
        return;
      }
      case "index":
        emit(
          phase,
          mysql || mssql ? `DROP INDEX ${q(object.name)} ON ${parent}` : `DROP INDEX ${target}`,
          { dangerous: true },
        );
        return;
      case "trigger":
        emit(
          phase,
          postgres ? `DROP TRIGGER ${q(object.name)} ON ${parent}` : `DROP TRIGGER ${target}`,
          { dangerous: true },
        );
        return;
      case "function":
      case "procedure":
        emit(
          phase,
          postgres
            ? `DROP ${type.toUpperCase()} ${qualified(object.attributes.routine ?? object.name)}(${object.attributes.arguments ?? ""})`
            : `DROP ${type.toUpperCase()} ${target}`,
          { dangerous: true },
        );
        return;
      case "type":
        emit(
          phase,
          `DROP ${postgres && object.attributes.kind === "domain" ? "DOMAIN" : "TYPE"} ${target}`,
          { dangerous: true, name: object.name, body: object.ddl },
        );
        return;
      case "comment":
        emit(phase, object.ddl.replace(/\sIS\s'[\s\S]*'$/, oracle ? " IS ''" : " IS NULL"));
        return;
      case "grant":
        emit(
          phase,
          object.ddl
            .replace(/ WITH GRANT OPTION$/, "")
            .replace(/^GRANT (.+?) ON (.+) TO (.+)$/s, "REVOKE $1 ON $2 FROM $3"),
        );
        return;
      default: {
        const keyword =
          type === "materialized_view" ? "MATERIALIZED VIEW" : type.replace("_", " ").toUpperCase();
        const ifExists = postgres && type === "sequence" && object.parent ? "IF EXISTS " : "";
        emit(phase, `DROP ${keyword} ${ifExists}${target}`, {
          dangerous: true,
          name: VIEW_TYPES.has(type) ? object.name : undefined,
          body: object.ddl,
        });
      }
    }
  };

  const computedDependents = (column: CatalogObject) =>
    result.items
      .filter(
        (item) =>
          item.type === "column" &&
          item.parent === column.parent &&
          item.name !== column.name &&
          item.target &&
          !(item.status === "only_target" && selected[item.key]),
      )
      .map((item) => item.target as CatalogObject)
      .filter((other) =>
        referencesColumn(
          other.attributes.virtual ?? other.attributes.generated ?? "",
          column.name,
          kind,
        ),
      );

  const desired = (item: DiffItem) =>
    item.status === "identical" || selected[item.key] ? item.source : item.target;

  const rebuiltKeys = new Set<string>();
  const rebuildDependents = (table: string, column: string) => {
    for (const item of result.items) {
      if (
        item.parent !== table ||
        (item.type !== "index" && item.type !== "constraint") ||
        !item.target ||
        rebuiltKeys.has(item.key)
      )
        continue;
      const definition = item.target.attributes.definition ?? item.target.ddl;
      if (!referencesColumn(definition, column, kind)) continue;
      rebuiltKeys.add(item.key);
      drop(item.target);
      const wanted = desired(item);
      if (wanted) create(wanted);
    }
  };

  const alterColumn = (source: CatalogObject, target: CatalogObject) => {
    const a = source.attributes;
    const b = target.attributes;
    const changed = (name: string) => (a[name] ?? "") !== (b[name] ?? "");
    const table = qualified(source.parent ?? "");
    const column = q(source.name);
    if (changed("virtual") || changed("identity") || changed("generated")) {
      warnings.push(
        `${label(source)}: Identity-, virtuelle oder generierte Spalten müssen manuell angepasst werden.`,
      );
      return;
    }
    let typeChanged = changed("type") || changed("collation");
    const dependents = typeChanged ? computedDependents(target) : [];
    if (dependents.length > 0) {
      typeChanged = false;
      warnings.push(
        `${label(source)}: Der Datentyp wird nicht geändert, weil die berechnete Spalte ${dependents.map((item) => item.name).join(", ")} darauf aufbaut. Berechnete Spalte entfernen, Datentyp ändern und berechnete Spalte neu anlegen.`,
      );
    }
    if (oracle) {
      const parts: string[] = [];
      if (typeChanged) parts.push(a.type);
      if (changed("default")) parts.push(`DEFAULT ${a.default ?? "NULL"}`);
      if (changed("nullable")) parts.push(a.nullable === "NO" ? "NOT NULL" : "NULL");
      if (parts.length > 0)
        emit(
          CREATE_PHASE.column ?? 13,
          `ALTER TABLE ${table} MODIFY (${column} ${parts.join(" ")})`,
          {
            dangerous: typeChanged,
            checks: columnChecks(source, target, table, typeChanged),
          },
        );
      return;
    }
    if (mysql) {
      if (typeChanged || changed("default") || changed("nullable") || changed("on_update"))
        emit(CREATE_PHASE.column ?? 13, `ALTER TABLE ${table} MODIFY COLUMN ${source.ddl}`, {
          dangerous: typeChanged,
        });
      return;
    }
    if (mssql) {
      const structural = typeChanged || changed("nullable");
      if (structural) rebuildDependents(source.parent ?? "", source.name);
      const resetDefault = changed("default") || (typeChanged && Boolean(b.default));
      if (resetDefault && b.default)
        dropDefault(source.parent ?? "", source.name, (CREATE_PHASE.column ?? 13) - 0.1);
      if (structural)
        emit(
          CREATE_PHASE.column ?? 13,
          `ALTER TABLE ${table} ALTER COLUMN ${column} ${a.type}${a.collation ? ` COLLATE ${a.collation}` : ""} ${a.nullable === "NO" ? "NOT NULL" : "NULL"}`,
          { dangerous: typeChanged },
        );
      if (resetDefault && a.default)
        emit(
          (CREATE_PHASE.column ?? 13) + 0.1,
          `ALTER TABLE ${table} ADD DEFAULT ${a.default} FOR ${column}`,
        );
      return;
    }
    if (typeChanged)
      emit(
        CREATE_PHASE.column ?? 13,
        `ALTER TABLE ${table} ALTER COLUMN ${column} TYPE ${a.type}${a.collation ? ` COLLATE ${a.collation}` : ""} USING ${column}::${a.type}`,
        { dangerous: true },
      );
    if (changed("default"))
      emit(
        CREATE_PHASE.column ?? 13,
        a.default
          ? `ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT ${a.default}`
          : `ALTER TABLE ${table} ALTER COLUMN ${column} DROP DEFAULT`,
      );
    if (changed("nullable"))
      emit(
        CREATE_PHASE.column ?? 13,
        `ALTER TABLE ${table} ALTER COLUMN ${column} ${a.nullable === "NO" ? "SET" : "DROP"} NOT NULL`,
      );
  };

  const alterSequence = (source: CatalogObject, target: CatalogObject) => {
    const a = source.attributes;
    const b = target.attributes;
    const changed = (name: string) => (a[name] ?? "") !== (b[name] ?? "");
    const clauses: string[] = [];
    if (!oracle && changed("type")) clauses.push(`AS ${a.type}`);
    if (changed("increment")) clauses.push(`INCREMENT BY ${a.increment}`);
    if (changed("min")) clauses.push(`MINVALUE ${a.min}`);
    if (changed("max")) clauses.push(`MAXVALUE ${a.max}`);
    if (!oracle && changed("start")) clauses.push(`START WITH ${a.start}`);
    if (changed("cache")) clauses.push(oracle ? a.cache : `CACHE ${a.cache}`);
    if (changed("cycle")) clauses.push(a.cycle);
    if (oracle && changed("order")) clauses.push(a.order);
    const sequence = qualified(source.name);
    if (clauses.length > 0)
      emit(CREATE_PHASE.sequence ?? 11, `ALTER SEQUENCE ${sequence} ${clauses.join(" ")}`);
    if (!oracle && changed("owned_column") && source.parent && a.owned_column)
      emit(
        SEQUENCE_OWNER_PHASE,
        `ALTER SEQUENCE ${sequence} OWNED BY ${qualified(source.parent)}.${q(a.owned_column)}`,
      );
    if (!result.options.ignoreSequenceValues && a.current && changed("current"))
      emit(
        (CREATE_PHASE.sequence ?? 11) + 0.1,
        oracle
          ? `ALTER SEQUENCE ${sequence} RESTART START WITH ${a.current}`
          : `SELECT setval('${sequence.replace(/'/g, "''")}', ${a.current})`,
        { dangerous: true },
      );
  };

  const alterEnum = (source: CatalogObject, target: CatalogObject) => {
    const parse = (value: string | undefined): string[] => {
      try {
        return JSON.parse(value ?? "[]");
      } catch {
        return [];
      }
    };
    const wanted = parse(source.attributes.labels);
    const present = parse(target.attributes.labels);
    const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
    const removed = present.filter((value) => !wanted.includes(value));
    if (removed.length > 0)
      warnings.push(
        `${label(source)}: Enum-Werte ${removed.join(", ")} fehlen in der Quelle und können nicht automatisch entfernt werden.`,
      );
    wanted.forEach((value, index) => {
      if (present.includes(value)) return;
      const anchor =
        index > 0
          ? `AFTER ${literal(wanted[index - 1])}`
          : present.length > 0
            ? `BEFORE ${literal(present[0])}`
            : "";
      emit(
        PRE_TRANSACTION_PHASE,
        `ALTER TYPE ${qualified(source.name)} ADD VALUE ${literal(value)}${anchor ? ` ${anchor}` : ""}`,
      );
    });
  };

  const alter = (item: DiffItem) => {
    const source = item.source as CatalogObject;
    const target = item.target as CatalogObject;
    switch (item.type) {
      case "table":
        warnings.push(
          `${label(source)}: ${item.differsBy.join(", ")} weichen ab und müssen manuell angepasst werden.`,
        );
        return;
      case "column":
        alterColumn(source, target);
        return;
      case "sequence":
        alterSequence(source, target);
        return;
      case "constraint":
      case "index":
        if (rebuiltKeys.has(item.key)) return;
        rebuiltKeys.add(item.key);
        drop(target);
        create(source);
        return;
      case "trigger":
        if (!oracle) drop(target);
        if (!oracle || item.differsBy.includes("Definition")) create(source);
        else
          emit(
            CREATE_PHASE.trigger ?? 22,
            triggerStatus(source, source.attributes.status !== "DISABLED"),
          );
        return;
      case "type":
        if (!oracle) {
          if (source.attributes.kind === "enum" && target.attributes.kind === "enum")
            alterEnum(source, target);
          else
            warnings.push(
              `${label(source)}: Domains und zusammengesetzte Typen müssen manuell angepasst werden.`,
            );
          return;
        }
        create(source);
        return;
      case "grant":
        drop(target);
        create(source);
        return;
      case "function":
      case "procedure":
        if (mysql) drop(target);
        create(source);
        return;
      default:
        create(source);
    }
  };

  const tableRebuild = new Map<string, DiffItem>();
  if (sqlite)
    for (const table of result.items) {
      if (table.type !== "table" || !table.source || !table.target) continue;
      const children = result.items.filter(
        (item) =>
          item.parent === table.name &&
          (item.type === "column" || item.type === "constraint") &&
          item.status !== "identical",
      );
      const chosen = children.filter((item) => selected[item.key]);
      if (chosen.length === 0) continue;
      if (
        chosen.length === children.length &&
        chosen.every(
          (item) =>
            item.type === "column" &&
            item.status === "only_source" &&
            item.source &&
            sqliteAddable(item.source),
        )
      )
        continue;
      tableRebuild.set(table.name, table);
      if (chosen.length < children.length)
        warnings.push(
          `Tabelle ${table.name}: SQLite baut die Tabelle neu auf; dabei werden alle Spalten- und Constraint-Unterschiede übernommen, auch nicht ausgewählte.`,
        );
    }

  const rebuild = new Map<string, DiffItem>();
  for (const item of result.items)
    if (
      selected[item.key] &&
      item.status === "different" &&
      VIEW_TYPES.has(item.type) &&
      (postgres || sqlite || (oracle && item.type === "materialized_view"))
    )
      rebuild.set(item.name, item);
  if (postgres) {
    const altered = new Set<string>();
    for (const item of result.items)
      if (
        selected[item.key] &&
        item.type === "column" &&
        item.parent &&
        item.target &&
        (item.source?.attributes.type !== item.target.attributes.type ||
          item.source?.attributes.collation !== item.target.attributes.collation)
      )
        altered.add(item.parent);
    const views = result.items.filter(
      (item) =>
        VIEW_TYPES.has(item.type) &&
        item.target &&
        !(selected[item.key] && item.status === "only_target"),
    );
    for (let grew = true; grew; ) {
      grew = false;
      for (const view of views)
        if (
          !rebuild.has(view.name) &&
          [...altered, ...rebuild.keys()].some((name) =>
            mentions(view.target?.ddl ?? "", name, kind),
          )
        ) {
          rebuild.set(view.name, view);
          grew = true;
        }
    }
  }
  if (rebuild.size > 0 && !result.types.includes("grant") && !sqlite)
    warnings.push(
      `Views werden neu erstellt (${[...rebuild.keys()].join(", ")}); bestehende Berechtigungen gehen verloren, weil Grants nicht verglichen werden.`,
    );
  for (const item of rebuild.values()) {
    key = item.key;
    const target = item.target as CatalogObject;
    drop(target);
    const object = desired(item);
    if (!object) continue;
    const children = result.items
      .filter((child) => child.parent === item.name && child.type !== "column")
      .map(desired)
      .filter((child): child is CatalogObject => Boolean(child));
    create(object, children);
    if (postgres && target.attributes.owner)
      emit(
        (CREATE_PHASE.view ?? 17) + 0.1,
        `ALTER ${item.type === "materialized_view" ? "MATERIALIZED VIEW" : "VIEW"} ${qualified(item.name)} OWNER TO ${q(target.attributes.owner)}`,
      );
  }

  for (const table of tableRebuild.values()) {
    key = table.key;
    const source = table.source as CatalogObject;
    const copy = qualified(`_l8db_copy_${table.name}`);
    const copied = result.items
      .filter(
        (item) =>
          item.type === "column" &&
          item.parent === table.name &&
          item.source &&
          item.target &&
          !item.source.attributes.generated &&
          !item.target.attributes.generated,
      )
      .map((item) => q(item.name))
      .join(", ");
    warnings.push(
      `Tabelle ${table.name} wird neu aufgebaut: Daten sichern, Tabelle löschen und neu anlegen, Daten zurückkopieren. Indizes und Trigger werden neu angelegt.`,
    );
    const phase = (CREATE_PHASE.table ?? 12) + 0.5;
    if (copied)
      emit(phase, `CREATE TABLE ${copy} AS SELECT ${copied} FROM ${qualified(table.name)}`, {
        repeat: true,
      });
    emit(phase, `DROP TABLE ${qualified(table.name)}`, { dangerous: true, repeat: true });
    emit(phase, source.ddl, { repeat: true });
    if (copied) {
      emit(
        phase,
        `INSERT INTO ${qualified(table.name)} (${copied}) SELECT ${copied} FROM ${copy}`,
        { repeat: true },
      );
      emit(phase, `DROP TABLE ${copy}`, { repeat: true });
    }
    for (const child of result.items) {
      if (child.parent !== table.name || (child.type !== "index" && child.type !== "trigger"))
        continue;
      const object = desired(child);
      key = child.key;
      if (object) create(object);
    }
  }

  for (const item of result.items) {
    if (!selected[item.key] || item.status === "identical") continue;
    if (rebuild.has(item.parent ?? "") || (VIEW_TYPES.has(item.type) && rebuild.has(item.name)))
      continue;
    if (tableRebuild.has(item.parent ?? "") && item.type !== "table") continue;
    key = item.key;
    if (item.status === "only_source" && item.source)
      create(item.source, CONTAINER_TYPES.has(item.type) ? item.children : []);
    else if (item.status === "only_target" && item.target)
      drop(item.target, CONTAINER_TYPES.has(item.type) ? item.children : []);
    else if (item.status === "different") alter(item);
  }

  if (sqlite && statements.length > 0) {
    key = "";
    emit(-0.5, "PRAGMA defer_foreign_keys = ON");
  }

  const ordered = statements
    .map((statement, index) => ({ statement, index }))
    .sort((a, b) => a.statement.phase - b.statement.phase || a.index - b.index)
    .map(({ statement }) => statement);
  const phases = new Map<number, SyncStatement[]>();
  for (const statement of ordered) {
    const group = phases.get(statement.phase) ?? [];
    group.push(statement);
    phases.set(statement.phase, group);
  }
  const final: SyncStatement[] = [];
  for (const [phase, group] of phases)
    final.push(
      ...(phase === CREATE_PHASE.view || phase === CREATE_PHASE.type
        ? sortByDependencies(group, dependencies, kind)
        : phase === DROP_PHASE.view || phase === DROP_PHASE.type
          ? sortByDependencies(group, dependencies, kind).reverse()
          : group),
    );
  return { statements: final, warnings: [...new Set(warnings)] };
}

export function renderSyncScript(
  script: SyncScript,
  meta: { kind: CompareResult["kind"]; sourceLabel: string; targetLabel: string },
): string {
  const kind = meta.kind;
  const lines = [
    "-- Schema-Synchronisation",
    `-- Quelle: ${meta.sourceLabel}`,
    `-- Ziel:   ${meta.targetLabel}`,
  ];
  for (const warning of script.warnings) lines.push(`-- Hinweis: ${warning}`);
  lines.push("");
  const note = (dangerous: boolean) => {
    if (dangerous) lines.push("-- Achtung: kann Daten verändern oder löschen");
  };
  if (kind === "oracle") {
    for (const statement of script.statements) {
      note(statement.dangerous);
      lines.push(statement.plsql ? `${statement.sql}\n/` : `${statement.sql};`, "");
    }
    return `${lines.join("\n").trimEnd()}\n`;
  }
  if (kind === "mysql") {
    lines.push(
      "-- MySQL schreibt DDL-Anweisungen sofort fest; ein Rollback ist nicht möglich.",
      "",
    );
    for (const statement of script.statements) {
      note(statement.dangerous);
      if (statement.plsql) lines.push("DELIMITER $$", `${statement.sql}$$`, "DELIMITER ;", "");
      else lines.push(`${statement.sql};`, "");
    }
    return `${lines.join("\n").trimEnd()}\n`;
  }
  if (kind === "mssql") {
    lines.push("SET XACT_ABORT ON;", "BEGIN TRANSACTION;", "GO", "");
    for (const statement of script.statements) {
      note(statement.dangerous);
      lines.push(statement.plsql ? statement.sql : `${statement.sql};`, "GO", "");
    }
    lines.push("COMMIT TRANSACTION;", "GO");
    return `${lines.join("\n").trimEnd()}\n`;
  }
  if (kind === "sqlite") {
    lines.push("PRAGMA foreign_keys = OFF;", "BEGIN;", "");
    for (const statement of script.statements) {
      note(statement.dangerous);
      lines.push(`${statement.sql};`, "");
    }
    lines.push("PRAGMA foreign_key_check;", "COMMIT;", "PRAGMA foreign_keys = ON;");
    return `${lines.join("\n").trimEnd()}\n`;
  }
  let open = false;
  for (const statement of script.statements) {
    if (!open && statement.phase !== PRE_TRANSACTION_PHASE) {
      lines.push("BEGIN;", "SET LOCAL check_function_bodies = false;", "");
      open = true;
    }
    note(statement.dangerous);
    lines.push(`${statement.sql};`, "");
  }
  if (!open) lines.push("BEGIN;", "SET LOCAL check_function_bodies = false;", "");
  lines.push("COMMIT;");
  return `${lines.join("\n").trimEnd()}\n`;
}
