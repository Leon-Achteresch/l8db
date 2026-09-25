import type { CompareSideSelection } from "@/lib/compare-types";
import type { DatabaseKind } from "@/lib/db";
import { identifierStyleForKind, quoteIdentifier } from "@/lib/export";
import { alterColumnStatements } from "@/lib/migration-script/sql";
import type { SnapshotColumn } from "@/lib/schema-snapshot";
import { splitSqlStatements } from "@/lib/sql-statements";

const IDENTIFIER = '(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$#]*)';
const DDL_HEADER = new RegExp(
  `^CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:(?:NON)?EDITIONABLE\\s+)?(FUNCTION|PROCEDURE|PACKAGE(?:\\s+BODY)?)\\s+(${IDENTIFIER}(?:\\s*\\.\\s*${IDENTIFIER})?)`,
  "i",
);
const VIEW_HEADER = new RegExp(
  `^CREATE\\s+(?:OR\\s+REPLACE\\s+)?((?:(?:NO\\s+)?FORCE\\s+)?(?:(?:NON)?EDITION(?:ING|ABLE)\\s+(?:EDITIONING\\s+)?)?)VIEW\\s+${IDENTIFIER}(?:\\s*\\.\\s*${IDENTIFIER})?`,
  "i",
);

function columns(definition: string): { columns: SnapshotColumn[]; rest: string } {
  const match = /^TABLE [^\n]+\nCOLUMNS\n([\s\S]*?)(?=\n(?:CONSTRAINTS|INDEXES|TRIGGERS)\n|$)/.exec(
    definition,
  );
  if (!match) throw new Error("Die Tabellenstruktur konnte nicht eindeutig gelesen werden.");
  const parsed = match[1]
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      const column = /^\s+(\S+) (.+?) (NOT NULL|NULL)(?: DEFAULT (.*?))?( PRIMARY KEY)?$/.exec(
        line.trimEnd(),
      );
      if (!column) throw new Error(`Spaltendefinition ist nicht eindeutig: ${line.trim()}`);
      return {
        name: column[1],
        data_type: column[2],
        is_nullable: column[3] === "NULL",
        column_default: column[4] ?? null,
        is_primary_key: Boolean(column[5]),
        ordinal_position: index + 1,
        character_maximum_length: null,
      };
    });
  if (!parsed.length || new Set(parsed.map((column) => column.name)).size !== parsed.length)
    throw new Error("Die Tabelle braucht eindeutige Spaltennamen.");
  return { columns: parsed, rest: definition.slice(match[0].length) };
}

function oracleStructure(rest: string): string {
  const lines = rest
    .split("\n")
    .filter((line) => line && !/^\s*\S+ CHECK \([^)]*\) CHECK \("[^"]+" IS NOT NULL\)$/.test(line));
  return lines
    .filter(
      (line, index) =>
        line !== "CONSTRAINTS" || !/^(INDEXES|TRIGGERS)?$/.test(lines[index + 1] ?? ""),
    )
    .map((line) => line.replace(/\bSYS_C\d+\b/g, "SYS_C").replace(/"[^"]+"\./g, ""))
    .sort()
    .join("\n");
}

function oracleTablePlan(
  target: string,
  before: SnapshotColumn[],
  after: SnapshotColumn[],
): string[] {
  const name = (column: SnapshotColumn) => quoteIdentifier(column.name, "double");
  const modify = after.flatMap((column) => {
    const old = before.find((item) => item.name === column.name);
    if (!old) return [];
    if (
      old.column_default !== column.column_default &&
      [old.column_default, column.column_default].includes("IDENTITY")
    )
      throw new Error("Identitätsspalten bitte im Tabelleneditor ändern.");
    const parts = [
      old.data_type !== column.data_type ? column.data_type : "",
      old.column_default !== column.column_default
        ? `DEFAULT ${column.column_default ?? "NULL"}`
        : "",
      old.is_nullable !== column.is_nullable ? (column.is_nullable ? "NULL" : "NOT NULL") : "",
    ].filter(Boolean);
    return parts.length ? [`${name(column)} ${parts.join(" ")}`] : [];
  });
  const add = after
    .filter((column) => !before.some((item) => item.name === column.name))
    .map((column) => {
      if (column.column_default === "IDENTITY")
        throw new Error("Identitätsspalten bitte im Tabelleneditor anlegen.");
      return `${name(column)} ${column.data_type}${column.column_default === null ? "" : ` DEFAULT ${column.column_default}`}${column.is_nullable ? "" : " NOT NULL"}`;
    });
  const drop = before
    .filter((column) => !after.some((item) => item.name === column.name))
    .map(name);
  return [
    modify.length ? `ALTER TABLE ${target} MODIFY (${modify.join(", ")})` : "",
    add.length ? `ALTER TABLE ${target} ADD (${add.join(", ")})` : "",
    drop.length ? `ALTER TABLE ${target} DROP (${drop.join(", ")})` : "",
  ].filter(Boolean);
}

function tablePlan(kind: DatabaseKind, baseline: string, draft: string, target: string): string[] {
  if (kind !== "postgres" && kind !== "oracle")
    throw new Error(
      "Tabellenänderungen können hier derzeit nur für PostgreSQL und Oracle sicher erzeugt und geprüft werden.",
    );
  const before = columns(baseline);
  const after = columns(draft);
  const structure = kind === "oracle" ? oracleStructure : (rest: string) => rest;
  if (structure(before.rest) !== structure(after.rest))
    throw new Error(
      "Änderungen an Constraints, Indizes und Triggern bitte im jeweiligen Objekteditor ausführen. Der Entwurf bleibt erhalten.",
    );
  const primary = (items: SnapshotColumn[]) =>
    items
      .filter((item) => item.is_primary_key)
      .map((item) => item.name)
      .sort()
      .join("\n");
  if (primary(before.columns) !== primary(after.columns))
    throw new Error("Primärschlüsseländerungen bitte im Tabelleneditor prüfen und ausführen.");
  if (kind === "oracle") return oracleTablePlan(target, before.columns, after.columns);
  const sql: string[] = [];
  for (const column of after.columns) {
    const old = before.columns.find((item) => item.name === column.name);
    if (old)
      sql.push(...alterColumnStatements(target, old, column, "double").map((item) => item.sql));
    else
      sql.push(
        `ALTER TABLE ${target} ADD COLUMN ${quoteIdentifier(column.name, "double")} ${column.data_type}${column.column_default === null ? "" : ` DEFAULT ${column.column_default}`}${column.is_nullable ? "" : " NOT NULL"};`,
      );
  }
  for (const column of before.columns) {
    if (!after.columns.some((item) => item.name === column.name))
      sql.push(`ALTER TABLE ${target} DROP COLUMN ${quoteIdentifier(column.name, "double")};`);
  }
  return sql;
}

function sequenceFields(definition: string): Map<string, string> {
  return new Map(
    [...definition.matchAll(/^\s+(\w+) (.+)$/gm)].map((match) => [match[1], match[2].trim()]),
  );
}

function oracleSequencePlan(baseline: string, draft: string, target: string): string[] {
  const before = sequenceFields(baseline);
  const after = sequenceFields(draft);
  const changed = (key: string) => after.has(key) && after.get(key) !== before.get(key);
  if (changed("data_type") || (changed("start") && after.get("start") !== after.get("min")))
    throw new Error("Datentyp und Startwert einer Oracle-Sequenz lassen sich nicht ändern.");
  const parts = [
    changed("increment") ? `INCREMENT BY ${after.get("increment")}` : "",
    changed("min") ? `MINVALUE ${after.get("min")}` : "",
    changed("max") ? `MAXVALUE ${after.get("max")}` : "",
    changed("cycle") ? (after.get("cycle") === "YES" ? "CYCLE" : "NOCYCLE") : "",
  ].filter(Boolean);
  if (parts.some((part) => !/^[A-Z ]+(-?\d+)?$/.test(part)))
    throw new Error("Die Sequenzwerte müssen ganze Zahlen sein.");
  return parts.length ? [`ALTER SEQUENCE ${target} ${parts.join(" ")}`] : [];
}

export function buildCompareApplyPlan(
  kind: DatabaseKind,
  side: CompareSideSelection,
  baseline: string,
  draft: string,
): string[] {
  if (!side.schema || !side.objectName) throw new Error("Bitte zuerst ein Zielobjekt auswählen.");
  if (!draft.trim()) throw new Error("Der Zielentwurf darf nicht leer sein.");
  if (kind !== "postgres" && kind !== "oracle")
    throw new Error(
      "Diese Datenbank unterstützt die erforderliche Prüfung ohne Speichern hier nicht.",
    );
  const style = identifierStyleForKind(kind);
  const qualified = (name: string) =>
    `${quoteIdentifier(side.schema ?? "", style)}.${quoteIdentifier(name, style)}`;
  let statements: string[];
  if (side.objectType === "table")
    statements = tablePlan(kind, baseline, draft, qualified(side.objectName));
  else if (side.objectType === "view") {
    const body = splitSqlStatements(draft, kind);
    const text = body.statements[0]?.text.trim().replace(/;\s*$/, "") ?? "";
    const header = VIEW_HEADER.exec(text);
    if (
      body.unterminated ||
      body.statements.length !== 1 ||
      !(header || /^(SELECT|WITH)\b/i.test(text))
    )
      throw new Error(
        "Die View muss aus genau einer SELECT-Abfrage oder CREATE VIEW-Anweisung bestehen.",
      );
    statements = [
      header
        ? `CREATE OR REPLACE ${header[1].replace(/\s+/g, " ")}VIEW ${qualified(side.objectName)}${text.slice(header[0].length)}`
        : `CREATE OR REPLACE VIEW ${qualified(side.objectName)} AS ${text}`,
    ];
  } else if (["routine", "procedure", "package"].includes(side.objectType)) {
    const source =
      side.objectType === "package"
        ? draft.replace(/^PACKAGE SPEC [^\n]+\n/gm, "").replace(/^PACKAGE BODY [^\n]+\n/gm, "\n/\n")
        : draft;
    const split = splitSqlStatements(source, kind);
    const expected =
      side.objectType === "routine"
        ? "FUNCTION"
        : side.objectType === "procedure"
          ? "PROCEDURE"
          : "PACKAGE";
    if (
      split.unterminated ||
      split.statements.length === 0 ||
      split.statements.length > (expected === "PACKAGE" ? 2 : 1)
    )
      throw new Error("Der Entwurf muss ausschließlich die Definition des Zielobjekts enthalten.");
    const originalHeader = DDL_HEADER.exec(baseline.replace(/^PACKAGE SPEC [^\n]+\n/, "").trim());
    if (!originalHeader)
      throw new Error("Die Identität des Zielobjekts konnte nicht sicher bestimmt werden.");
    const targetName = originalHeader[2]
      .split(/\.(?=(?:[^"]*"[^"]*")*[^"]*$)/)
      .at(-1)
      ?.trim();
    if (!targetName) throw new Error("Der Zielname fehlt.");
    const targetIdentifier = `${quoteIdentifier(side.schema, style)}.${targetName}`;
    const seen = new Set<string>();
    statements = split.statements.map(({ text }) => {
      const header = DDL_HEADER.exec(text.trim());
      if (
        !header ||
        !header[1].toUpperCase().startsWith(expected) ||
        seen.has(header[1].toUpperCase())
      )
        throw new Error("Der Entwurf enthält eine andere oder doppelte Objektdefinition.");
      seen.add(header[1].toUpperCase());
      if (expected !== "PACKAGE") {
        const signature = (value: string) =>
          value
            .slice(value.indexOf("("), value.search(/\b(?:RETURNS|RETURN|IS|AS)\b/i))
            .replace(/\s+/g, " ")
            .trim();
        if (
          signature(text.slice(header[0].length)) !==
          signature(baseline.slice(originalHeader[0].length))
        )
          throw new Error(
            "Eine geänderte Signatur muss im Objekteditor geprüft werden, damit kein anderes Objekt angelegt wird.",
          );
      }
      return text.trim().replace(DDL_HEADER, `CREATE OR REPLACE ${header[1]} ${targetIdentifier}`);
    });
  } else if (side.objectType === "sequence" && kind === "oracle")
    statements = oracleSequencePlan(baseline, draft, qualified(side.objectName));
  else
    throw new Error(
      "Für diesen Objekttyp kann noch kein sicheres Änderungsskript erzeugt werden. Der Entwurf bleibt erhalten.",
    );
  if (statements.length === 0)
    throw new Error(
      "Der Entwurf weicht nur in Angaben ab, die nichts am Objekt ändern (z. B. Schema, Systemnamen oder Spaltenreihenfolge). Es gibt nichts zu speichern.",
    );
  for (const statement of statements) {
    const split = splitSqlStatements(statement, kind);
    if (split.unterminated || split.statements.length !== 1)
      throw new Error("Eine Definition enthält zusätzliche oder unvollständige SQL-Anweisungen.");
  }
  return statements;
}
