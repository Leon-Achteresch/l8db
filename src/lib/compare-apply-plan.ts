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

function tablePlan(kind: DatabaseKind, baseline: string, draft: string, target: string): string[] {
  if (kind !== "postgres")
    throw new Error(
      "Tabellenänderungen können hier derzeit nur für PostgreSQL sicher erzeugt und geprüft werden.",
    );
  const before = columns(baseline);
  const after = columns(draft);
  if (before.rest !== after.rest)
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
  } else
    throw new Error(
      "Für diesen Objekttyp kann noch kein sicheres Änderungsskript erzeugt werden. Der Entwurf bleibt erhalten.",
    );
  if (statements.length === 0) throw new Error("Keine ausführbaren Änderungen am Ziel gefunden.");
  for (const statement of statements) {
    const split = splitSqlStatements(statement, kind);
    if (split.unterminated || split.statements.length !== 1)
      throw new Error("Eine Definition enthält zusätzliche oder unvollständige SQL-Anweisungen.");
  }
  return statements;
}
