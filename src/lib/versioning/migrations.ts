import {
  buildCompareApplyPlan,
  parseTableColumns,
  postgresTableStructure,
} from "@/lib/compare-apply-plan";
import { quoteIdentifier } from "@/lib/export";
import { columnDefinitionSql } from "@/lib/migration-script/sql";
import { checksum, deployKind, destructiveStatement, validateMigration } from "./model";
import { sqlCode } from "./sql-code";
import type { DatabaseRelease, ObjectSnapshot, ReleaseMigration, VersioningKind } from "./types";

export interface MigrationDraft {
  sql: string;
  changes: { label: string; status: "added" | "changed" | "removed"; generated: boolean }[];
  issues: { label: string; reason: string }[];
  parts?: { id: string; code: boolean; before: string | null; statements: string[] }[];
  removals?: number;
}

const CODE_TYPES = new Set(["view", "routine", "procedure", "package"]);

function joinStatements(kind: VersioningKind, statements: string[]) {
  return statements
    .map((statement) =>
      kind === "oracle" ? statement.replace(/\n\/\s*$/, "") : `${statement.replace(/;\s*$/, "")};`,
    )
    .join(kind === "oracle" ? "\n/\n" : "\n\n");
}

export async function splitMigrations(
  kind: VersioningKind,
  id: string,
  draft: MigrationDraft,
): Promise<ReleaseMigration[] | null> {
  if (!draft.parts?.length || draft.removals || draft.issues.length) return null;
  const firstCode = draft.parts.findIndex((part) => part.code);
  if (firstCode >= 0 && draft.parts.slice(firstCode).some((part) => !part.code)) return null;
  const structural = draft.parts.filter((part) => !part.code);
  const migrations: ReleaseMigration[] = [];
  if (structural.length) {
    const sql = joinStatements(
      kind,
      structural.flatMap((part) => part.statements),
    );
    migrations.push({
      id: "schema",
      title: `Schemaänderungen ${id}`,
      sql,
      checksum: await checksum(sql),
      touches: structural.map((part) => part.id),
      before: Object.fromEntries(structural.map((part) => [part.id, part.before])),
    });
  }
  for (const [index, part] of draft.parts.filter((entry) => entry.code).entries()) {
    const sql = joinStatements(kind, part.statements);
    migrations.push({
      id: `code-${index + 1}`,
      title: `Programmcode ${part.id}`,
      kind: "repeatable",
      sql,
      checksum: await checksum(sql),
      touches: [part.id],
      before: { [part.id]: part.before },
    });
  }
  return migrations;
}

function createTable(kind: VersioningKind, snapshot: ObjectSnapshot) {
  const parsed = parseTableColumns(snapshot.definition);
  const { columns } = parsed;
  if (columns.some((column) => column.column_default?.startsWith("IDENTITY")))
    throw new Error("Identitätsspalten benötigen eine manuell geprüfte CREATE-Migration.");
  const { schema, objectName } = snapshot.object.selection;
  const rest =
    kind === "postgres"
      ? postgresTableStructure(parsed.rest, columns, objectName ?? "")
      : parsed.rest;
  const target = `${quoteIdentifier(schema ?? "", "double")}.${quoteIdentifier(objectName ?? "", "double")}`;
  const definitions = columns.map((column) => `  ${columnDefinitionSql(column, "double")}`);
  const constraints =
    /(?:^|\n)CONSTRAINTS\n([\s\S]*?)(?=\n(?:INDEXES|TRIGGERS)\n|$)/
      .exec(rest)?.[1]
      .split("\n")
      .filter(Boolean) ?? [];
  const names = new Set<string>();
  const foreignKeys: string[] = [];
  let hasPrimary = false;
  for (const line of constraints) {
    const match =
      /^\s*(\S+) (?:PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK) \([^\n]*?\) ((?:PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK)\b[\s\S]*)$/.exec(
        line,
      );
    if (!match) throw new Error("Eine Constraint-Definition muss manuell ergänzt werden.");
    names.add(match[1]);
    hasPrimary ||= /^PRIMARY KEY\b/.test(match[2]);
    const constraint = `CONSTRAINT ${quoteIdentifier(match[1], "double")} ${match[2]}`;
    if (/^FOREIGN KEY\b/.test(match[2]))
      foreignKeys.push(`ALTER TABLE ${target} ADD ${constraint}`);
    else definitions.push(`  ${constraint}`);
  }
  if (!hasPrimary) {
    const primary = columns
      .filter((column) => column.is_primary_key)
      .map((column) => quoteIdentifier(column.name, "double"));
    if (primary.length) definitions.push(`  PRIMARY KEY (${primary.join(", ")})`);
  }
  if (/(?:^|\n)TRIGGERS\n/.test(rest))
    throw new Error(
      "Trigger einer neuen Tabelle müssen manuell und mit ihren Abhängigkeiten ergänzt werden.",
    );
  const indexes = /(?:^|\n)INDEXES\n([\s\S]*?)$/.exec(rest)?.[1].split("\n").filter(Boolean) ?? [];
  const extraIndexes: string[] = [];
  for (const line of indexes) {
    const match = /^\s*CREATE (?:UNIQUE )?INDEX (?:"[^"\n]+"\.)?(?:"([^"\n]+)"|(\S+)) ON\b/.exec(
      line,
    );
    if (!match) throw new Error("Eine Index-Definition muss manuell ergänzt werden.");
    if (!names.has(match[1] ?? match[2])) extraIndexes.push(line.trim());
  }
  const statements = [
    `CREATE TABLE ${target} (\n${definitions.join(",\n")}\n)`,
    ...foreignKeys,
    ...extraIndexes,
  ];
  for (const sql of statements) {
    if (validateMigration(sql, deployKind(kind)).length !== 1)
      throw new Error("Die neue Tabelle enthält zusätzliche SQL-Anweisungen.");
  }
  return statements;
}

function sequencePlan(kind: VersioningKind, snapshot: ObjectSnapshot, previous?: ObjectSnapshot) {
  const fields = (definition: string) =>
    new Map(
      [...definition.matchAll(/^\s+(\w+) (.+)$/gm)].map((match) => [match[1], match[2].trim()]),
    );
  const after = fields(snapshot.definition);
  const before = previous ? fields(previous.definition) : null;
  const { schema, objectName } = snapshot.object.selection;
  const parts: string[] = [];
  for (const [field, clause] of [
    ["start", "START WITH"],
    ["increment", "INCREMENT BY"],
    ["min", "MINVALUE"],
    ["max", "MAXVALUE"],
  ]) {
    const value = after.get(field);
    if (!value || !/^-?\d+$/.test(value)) throw new Error("Sequenzwerte müssen ganze Zahlen sein.");
    if (!before || before.get(field) !== value) {
      if (before && field === "start")
        throw new Error("Eine Änderung des Sequenzstarts muss manuell geprüft werden.");
      parts.push(`${clause} ${value}`);
    }
  }
  if (!before || before.get("cycle") !== after.get("cycle")) {
    if (!["YES", "NO"].includes(after.get("cycle") ?? ""))
      throw new Error("Ungültiger Zyklus der Sequenz.");
    parts.push(after.get("cycle") === "YES" ? "CYCLE" : kind === "oracle" ? "NOCYCLE" : "NO CYCLE");
  }
  if (kind === "postgres") {
    const type = after.get("data_type");
    if (!type || !["smallint", "integer", "bigint"].includes(type))
      throw new Error("Sequenztyp muss manuell geprüft werden.");
    if (!before || before.get("data_type") !== type) parts.unshift(`AS ${type}`);
  } else if (before && before.get("data_type") !== after.get("data_type"))
    throw new Error("Oracle-Sequenztyp muss manuell geprüft werden.");
  if (!parts.length) throw new Error("Keine ausführbare Änderung an der Sequenz.");
  return [
    `${before ? "ALTER" : "CREATE"} SEQUENCE ${quoteIdentifier(schema ?? "", "double")}.${quoteIdentifier(objectName ?? "", "double")} ${parts.join(" ")}`,
  ];
}

export function generateMigration(
  kind: VersioningKind,
  before: DatabaseRelease,
  current: ObjectSnapshot[],
  allowDrops = false,
  additiveOnly = false,
): MigrationDraft {
  const changes: MigrationDraft["changes"] = [];
  const issues: MigrationDraft["issues"] = [];
  const statements: string[] = [];
  const deferred: string[] = [];
  const parts: NonNullable<MigrationDraft["parts"]> = [];
  let removals = 0;
  const rank = (item: ObjectSnapshot) =>
    ({
      sequence: 0,
      table: 1,
      routine: 2,
      procedure: 2,
      package: 2,
      view: 3,
      materialized_view: 4,
    })[item.object.selection.objectType];
  for (const item of [...current].sort((a, b) => rank(a) - rank(b))) {
    const old = before.objects.find((entry) => entry.object.id === item.object.id);
    if (old?.checksum === item.checksum) continue;
    const label = `${item.object.selection.schema}.${item.object.selection.objectName}`;
    const change = {
      label,
      status: old ? ("changed" as const) : ("added" as const),
      generated: false,
    };
    changes.push(change);
    try {
      const generated =
        item.object.selection.objectType === "sequence"
          ? sequencePlan(kind, item, old)
          : !old && item.object.selection.objectType === "table"
            ? createTable(kind, item)
            : buildCompareApplyPlan(
                kind,
                { ...item.object.selection, connectionId: null, database: null },
                old?.definition ?? item.definition,
                item.definition,
              );
      if (!allowDrops && generated.some((sql) => /\bDROP\b/i.test(sqlCode(sql))))
        throw new Error("Entfernungen erst ausdrücklich freigeben oder manuell schreiben.");
      if (additiveOnly && !allowDrops && generated.some(destructiveStatement))
        throw new Error(
          "Nur additiv: Typwechsel und Verkürzungen ausdrücklich freigeben oder manuell schreiben.",
        );
      const part = {
        id: item.object.id,
        code: CODE_TYPES.has(item.object.selection.objectType),
        before: old?.checksum ?? null,
        statements: [] as string[],
      };
      for (const sql of generated) {
        if (!old && item.object.selection.objectType === "table" && /^ALTER TABLE\b/.test(sql))
          deferred.push(sql);
        else {
          statements.push(sql);
          part.statements.push(sql);
        }
      }
      parts.push(part);
      change.generated = true;
    } catch (cause) {
      issues.push({ label, reason: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  for (const old of [...before.objects].sort((a, b) => rank(b) - rank(a))) {
    if (current.some((item) => item.object.id === old.object.id)) continue;
    const { schema, objectName, objectType } = old.object.selection;
    const label = `${schema}.${objectName}`;
    const type = (
      {
        table: "TABLE",
        view: "VIEW",
        materialized_view: "MATERIALIZED VIEW",
        sequence: "SEQUENCE",
        package: "PACKAGE",
      } as Partial<Record<typeof objectType, string>>
    )[objectType];
    const generated = Boolean(allowDrops && type);
    removals++;
    changes.push({ label, status: "removed", generated });
    if (generated)
      statements.push(
        `DROP ${type} ${quoteIdentifier(schema ?? "", "double")}.${quoteIdentifier(objectName ?? "", "double")}`,
      );
    else
      issues.push({
        label,
        reason:
          "Objektentfernung ausdrücklich freigeben oder eine DROP-Migration mit geprüften Abhängigkeiten ergänzen.",
      });
  }
  const sql = joinStatements(kind, [...statements, ...deferred]);
  if (sql) validateMigration(sql, deployKind(kind));
  if (deferred.length) {
    const structural = [...parts].reverse().find((part) => !part.code);
    if (structural) structural.statements.push(...deferred);
    else removals++;
  }
  return { sql, changes, issues, parts, removals };
}

export async function groundwork(
  kind: VersioningKind,
  id: string,
  objects: ObjectSnapshot[],
): Promise<ReleaseMigration[]> {
  const empty = { objects: [] } as unknown as DatabaseRelease;
  const draft = generateMigration(kind, empty, objects);
  if (!draft.sql || draft.issues.length) return [];
  return [
    {
      id: "grundstand",
      title: `Grundstand ${id} für leere Datenbanken`,
      sql: draft.sql,
      checksum: await checksum(draft.sql),
      touches: objects.map((entry) => entry.object.id),
      before: Object.fromEntries(objects.map((entry) => [entry.object.id, null])),
    },
  ];
}
