import { splitSqlStatements } from "./split";

export interface StatementSummary {
  kind: string;
  preview: string;
}

const STATEMENT_LEAD_PATTERN = /^(?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/|\(\s*)*([A-Za-z]+)/;

export function summarizeStatement(text: string): StatementSummary {
  const trimmed = text.trim();
  const match = STATEMENT_LEAD_PATTERN.exec(trimmed);
  const kind = match ? match[1].toUpperCase() : "SQL";
  const firstLine = trimmed.split("\n")[0].trim();
  const preview =
    firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine || "Leeres Statement";
  return { kind, preview };
}

const DML_PATTERN = /^(INSERT|UPDATE|DELETE|MERGE|CALL|EXEC|EXECUTE)\b/i;

const PLSQL_BLOCK_PATTERN = /^(BEGIN|DECLARE)\b/i;

const DDL_PATTERN = /^(CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i;

const CREATE_VIEW_PATTERN = /^CREATE(\s+OR\s+REPLACE)?(\s+(TEMP|TEMPORARY|RECURSIVE))*\s+VIEW\b/i;

const IMPLICIT_DDL_COMMIT = new Set(["oracle", "mysql", "clickhouse", "cassandra"]);

export function isTransactionalStatement(sql: string, kind?: string): boolean {
  return someStatement(sql, kind, (text) => isTransactionalUnit(text, kind));
}

export function opensManagedTransaction(sql: string, kind?: string): boolean {
  return someStatement(sql, kind, (text) => changesData(text, kind));
}

function someStatement(sql: string, kind: string | undefined, test: (text: string) => boolean) {
  const { statements } = splitSqlStatements(sql, kind);
  if (statements.length > 1) return statements.some((statement) => test(leadText(statement.text)));
  return test(leadText(sql));
}

function leadText(sql: string): string {
  const trimmed = sql.trim();
  const lead = STATEMENT_LEAD_PATTERN.exec(trimmed);
  return lead ? trimmed.slice(lead[0].length - lead[1].length) : trimmed;
}

function changesData(text: string, kind?: string): boolean {
  return DML_PATTERN.test(text) || (kind === "oracle" && PLSQL_BLOCK_PATTERN.test(text));
}

function isTransactionalUnit(text: string, kind?: string): boolean {
  if (changesData(text, kind)) return true;
  if (!DDL_PATTERN.test(text)) return false;
  return !CREATE_VIEW_PATTERN.test(text) && !IMPLICIT_DDL_COMMIT.has(kind ?? "");
}

const CREATE_OBJECT_PATTERN =
  /^CREATE(?:\s+OR\s+REPLACE)?(?:\s+(?:EDITIONABLE|NONEDITIONABLE|FORCE|NO\s+FORCE|PUBLIC|GLOBAL|PRIVATE))*\s+(PACKAGE\s+BODY|TYPE\s+BODY|MATERIALIZED\s+VIEW|PACKAGE|VIEW|FUNCTION|PROCEDURE|TRIGGER|TYPE|SYNONYM)\s+((?:"[^"]+"|[A-Za-z0-9_$#]+)(?:\.(?:"[^"]+"|[A-Za-z0-9_$#]+))*)/i;

export function createObjectMessage(sql: string): string | null {
  const match = CREATE_OBJECT_PATTERN.exec(leadText(sql));
  if (!match) return null;
  return `${match[1].toUpperCase().replace(/\s+/g, " ")} ${match[2]} erstellt`;
}
