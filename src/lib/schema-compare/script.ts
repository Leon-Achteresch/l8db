import type { CatalogObject, CatalogObjectType } from "@/lib/db";
import { CONTAINER_TYPES, quoteName } from "./diff";
import type { CompareResult, DiffItem } from "./types";
import { OBJECT_TYPE_META } from "./types";

export interface SyncStatement {
  key: string;
  sql: string;
  plsql: boolean;
  dangerous: boolean;
  phase: number;
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

function mentions(sql: string, name: string): boolean {
  const pattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\.(?:${pattern(quoteName(name))}|${pattern(name)}(?![\\w$#]))`, "i").test(
    sql,
  );
}

function sortByDependencies(
  statements: SyncStatement[],
  dependencies: Map<SyncStatement, Dependency>,
) {
  const pending = [...statements];
  const ordered: SyncStatement[] = [];
  while (pending.length > 0) {
    const index = pending.findIndex((statement) =>
      pending.every((other) => {
        const name = dependencies.get(other)?.name;
        const body = dependencies.get(statement)?.body ?? statement.sql;
        return other === statement || !name || !mentions(body, name);
      }),
    );
    ordered.push(...pending.splice(index < 0 ? 0 : index, 1));
  }
  return ordered;
}

export function buildSyncScript(
  result: CompareResult,
  selected: Readonly<Record<string, boolean>>,
): SyncScript {
  const oracle = result.kind === "oracle";
  const schema = result.targetSchema;
  const qualified = (name: string) => `${quoteName(schema)}.${quoteName(name)}`;
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

  const emit = (
    phase: number,
    sql: string,
    options: { plsql?: boolean; dangerous?: boolean; name?: string; body?: string } = {},
  ) => {
    const text = options.plsql ? sql.trim() : sql.trim().replace(/;\s*$/, "");
    if (!text || seen.has(text)) return;
    seen.add(text);
    const statement: SyncStatement = {
      key,
      sql: text,
      plsql: Boolean(options.plsql),
      dangerous: Boolean(options.dangerous),
      phase,
    };
    statements.push(statement);
    if (options.name)
      dependencies.set(statement, { name: options.name, body: options.body ?? text });
  };

  const triggerStatus = (object: CatalogObject, enable: boolean) =>
    oracle
      ? `ALTER TRIGGER ${qualified(object.name)} ${enable ? "ENABLE" : "DISABLE"}`
      : `ALTER TABLE ${qualified(object.parent ?? "")} ${enable ? "ENABLE" : "DISABLE"} TRIGGER ${quoteName(object.name)}`;

  const create = (object: CatalogObject, children: CatalogObject[] = []) => {
    const type = object.object_type;
    const plsql = oracle && PLSQL_TYPES.has(type);
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
      emit(
        CREATE_PHASE.column ?? 13,
        oracle
          ? `ALTER TABLE ${qualified(object.parent ?? "")} ADD (${object.ddl})`
          : `ALTER TABLE ${qualified(object.parent ?? "")} ADD COLUMN ${object.ddl}`,
      );
      return;
    }
    let phase = CREATE_PHASE[type] ?? 30;
    if (isForeignKey(object)) phase = FK_CREATE_PHASE;
    if (type === "table" && object.attributes.partition_of) phase += 0.5;
    if (!oracle && (type === "function" || type === "procedure")) {
      const header = routineHeader(object.ddl);
      phase = Math.max(
        POSTGRES_ROUTINE_PHASE,
        ...createdRelations
          .filter((item) => mentions(header, item.name))
          .map((item) => (CREATE_PHASE[item.type] ?? 12) + 0.5),
      );
    }
    if (
      !oracle &&
      type === "index" &&
      /^CREATE UNIQUE INDEX/i.test(object.ddl) &&
      !materializedViews.has(object.parent ?? "")
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
    emit(phase, object.ddl, {
      plsql,
      name: SORTED_TYPES.has(type) ? object.name : undefined,
    });
    if (!oracle && type === "sequence" && object.parent && object.attributes.owned_column)
      emit(
        SEQUENCE_OWNER_PHASE,
        `ALTER SEQUENCE ${qualified(object.name)} OWNED BY ${qualified(object.parent)}.${quoteName(object.attributes.owned_column)}`,
      );
    if (type === "trigger" && object.attributes.status === "DISABLED")
      emit(phase + 0.1, triggerStatus(object, false));
    const inlineKey = /ORGANIZATION INDEX/i.test(object.ddl);
    for (const child of children)
      if (child.object_type !== "column" && !(inlineKey && child.attributes.kind === "P"))
        create(child);
  };

  const drop = (object: CatalogObject, children: CatalogObject[] = []) => {
    const type = object.object_type;
    let phase = isForeignKey(object) ? FK_DROP_PHASE : (DROP_PHASE[type] ?? 30);
    if (!oracle && (type === "function" || type === "procedure")) {
      const header = routineHeader(object.ddl);
      phase = Math.min(
        POSTGRES_ROUTINE_DROP_PHASE,
        ...droppedRelations
          .filter((item) => mentions(header, item.name))
          .map((item) => (DROP_PHASE[item.type] ?? 6) - 0.1),
      );
    }
    if (type === "table" && object.attributes.partition_of) phase -= 0.5;
    const target = qualified(object.name);
    const parent = qualified(object.parent ?? "");
    switch (type) {
      case "table": {
        for (const child of children)
          if (isForeignKey(child) || child.object_type === "trigger") drop(child);
        const partitions = result.items.filter(
          (item) =>
            item.type === "table" &&
            !selected[item.key] &&
            mentions(item.target?.attributes.partition_of ?? "", object.name),
        );
        if (partitions.length > 0)
          warnings.push(
            `${label(object)}: Löschen entfernt auch die nicht ausgewählten Partitionen ${partitions.map((item) => item.name).join(", ")}.`,
          );
        emit(phase, `DROP TABLE ${target}`, { dangerous: true });
        return;
      }
      case "column":
        emit(phase, `ALTER TABLE ${parent} DROP COLUMN ${quoteName(object.name)}`, {
          dangerous: true,
        });
        return;
      case "constraint":
        emit(phase, `ALTER TABLE ${parent} DROP CONSTRAINT ${quoteName(object.name)}`, {
          dangerous: true,
        });
        return;
      case "trigger":
        emit(
          phase,
          oracle ? `DROP TRIGGER ${target}` : `DROP TRIGGER ${quoteName(object.name)} ON ${parent}`,
          { dangerous: true },
        );
        return;
      case "function":
      case "procedure":
        emit(
          phase,
          oracle
            ? `DROP ${type.toUpperCase()} ${target}`
            : `DROP ${type.toUpperCase()} ${qualified(object.attributes.routine ?? object.name)}(${object.attributes.arguments ?? ""})`,
          { dangerous: true },
        );
        return;
      case "type":
        emit(
          phase,
          `DROP ${!oracle && object.attributes.kind === "domain" ? "DOMAIN" : "TYPE"} ${target}`,
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
        const ifExists = !oracle && type === "sequence" && object.parent ? "IF EXISTS " : "";
        emit(phase, `DROP ${keyword} ${ifExists}${target}`, {
          dangerous: true,
          name: VIEW_TYPES.has(type) ? object.name : undefined,
          body: object.ddl,
        });
      }
    }
  };

  const alterColumn = (source: CatalogObject, target: CatalogObject) => {
    const a = source.attributes;
    const b = target.attributes;
    const changed = (name: string) => (a[name] ?? "") !== (b[name] ?? "");
    const table = qualified(source.parent ?? "");
    const column = quoteName(source.name);
    if (changed("virtual") || changed("identity") || changed("generated")) {
      warnings.push(
        `${label(source)}: Identity-, virtuelle oder generierte Spalten müssen manuell angepasst werden.`,
      );
      return;
    }
    if (oracle) {
      const parts: string[] = [];
      if (changed("type")) parts.push(a.type);
      if (changed("default")) parts.push(`DEFAULT ${a.default ?? "NULL"}`);
      if (changed("nullable")) parts.push(a.nullable === "NO" ? "NOT NULL" : "NULL");
      if (parts.length > 0)
        emit(
          CREATE_PHASE.column ?? 13,
          `ALTER TABLE ${table} MODIFY (${column} ${parts.join(" ")})`,
          {
            dangerous: changed("type"),
          },
        );
      return;
    }
    if (changed("type") || changed("collation"))
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
        `ALTER SEQUENCE ${sequence} OWNED BY ${qualified(source.parent)}.${quoteName(a.owned_column)}`,
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
      default:
        create(source);
    }
  };

  const desired = (item: DiffItem) =>
    item.status === "identical" || selected[item.key] ? item.source : item.target;
  const rebuild = new Map<string, DiffItem>();
  for (const item of result.items)
    if (
      selected[item.key] &&
      item.status === "different" &&
      VIEW_TYPES.has(item.type) &&
      (!oracle || item.type === "materialized_view")
    )
      rebuild.set(item.name, item);
  if (!oracle) {
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
          [...altered, ...rebuild.keys()].some((name) => mentions(view.target?.ddl ?? "", name))
        ) {
          rebuild.set(view.name, view);
          grew = true;
        }
    }
  }
  if (rebuild.size > 0 && !result.types.includes("grant"))
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
    if (!oracle && target.attributes.owner)
      emit(
        (CREATE_PHASE.view ?? 17) + 0.1,
        `ALTER ${item.type === "materialized_view" ? "MATERIALIZED VIEW" : "VIEW"} ${qualified(item.name)} OWNER TO ${quoteName(target.attributes.owner)}`,
      );
  }

  for (const item of result.items) {
    if (!selected[item.key] || item.status === "identical") continue;
    if (rebuild.has(item.parent ?? "") || (VIEW_TYPES.has(item.type) && rebuild.has(item.name)))
      continue;
    key = item.key;
    if (item.status === "only_source" && item.source)
      create(item.source, CONTAINER_TYPES.has(item.type) ? item.children : []);
    else if (item.status === "only_target" && item.target)
      drop(item.target, CONTAINER_TYPES.has(item.type) ? item.children : []);
    else if (item.status === "different") alter(item);
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
        ? sortByDependencies(group, dependencies)
        : phase === DROP_PHASE.view || phase === DROP_PHASE.type
          ? sortByDependencies(group, dependencies).reverse()
          : group),
    );
  return { statements: final, warnings: [...new Set(warnings)] };
}

export function renderSyncScript(
  script: SyncScript,
  meta: { kind: CompareResult["kind"]; sourceLabel: string; targetLabel: string },
): string {
  const oracle = meta.kind === "oracle";
  const lines = [
    "-- Schema-Synchronisation",
    `-- Quelle: ${meta.sourceLabel}`,
    `-- Ziel:   ${meta.targetLabel}`,
  ];
  for (const warning of script.warnings) lines.push(`-- Hinweis: ${warning}`);
  lines.push("");
  let open = oracle;
  for (const statement of script.statements) {
    if (!open && statement.phase !== PRE_TRANSACTION_PHASE) {
      lines.push("BEGIN;", "SET LOCAL check_function_bodies = false;", "");
      open = true;
    }
    if (statement.dangerous) lines.push("-- Achtung: kann Daten verändern oder löschen");
    lines.push(oracle && statement.plsql ? `${statement.sql}\n/` : `${statement.sql};`, "");
  }
  if (!open) lines.push("BEGIN;", "SET LOCAL check_function_bodies = false;", "");
  if (!oracle) lines.push("COMMIT;");
  return `${lines.join("\n").trimEnd()}\n`;
}
