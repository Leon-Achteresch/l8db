import type { DatabaseKind } from "@/lib/db";
import { quoteIdent } from "@/lib/sql-filter/quote";

export type TemplateColumn = { name: string; is_primary_key?: boolean };

function target(schema: string, name: string, kind?: DatabaseKind | null) {
  const table = quoteIdent(name, kind);
  return schema ? `${quoteIdent(schema, kind)}.${table}` : table;
}

function param(column: string) {
  return `:${column.replace(/\W/g, "_").replace(/^(?=\d)/, "_")}`;
}

function assign(column: TemplateColumn, kind?: DatabaseKind | null) {
  return `${quoteIdent(column.name, kind)} = ${param(column.name)}`;
}

function columnListSql(columns: TemplateColumn[], kind?: DatabaseKind | null) {
  return columns.map((column) => quoteIdent(column.name, kind)).join(", ");
}

function selectStatementSql(
  schema: string,
  name: string,
  columns: TemplateColumn[],
  kind?: DatabaseKind | null,
) {
  const list = columns.length ? columnListSql(columns, kind) : "*";
  return `SELECT ${list}\nFROM ${target(schema, name, kind)};`;
}

function insertTemplateSql(
  schema: string,
  name: string,
  columns: TemplateColumn[],
  kind?: DatabaseKind | null,
) {
  const values = columns.map((column) => param(column.name)).join(", ");
  return `INSERT INTO ${target(schema, name, kind)} (${columnListSql(columns, kind)})\nVALUES (${values});`;
}

function updateTemplateSql(
  schema: string,
  name: string,
  columns: TemplateColumn[],
  kind?: DatabaseKind | null,
) {
  const keys = columns.filter((column) => column.is_primary_key);
  const values = columns.filter((column) => !column.is_primary_key);
  const set = (values.length ? values : columns).map((column) => assign(column, kind));
  const where = keys.length
    ? keys.map((column) => assign(column, kind)).join(" AND ")
    : "/* Bedingung */";
  return `UPDATE ${target(schema, name, kind)}\nSET ${set.join(",\n    ")}\nWHERE ${where};`;
}

export const SQL_TEMPLATE_LABELS = {
  select: "SELECT-Anweisung",
  insert: "INSERT-Vorlage",
  update: "UPDATE-Vorlage",
  columns: "Spaltenliste",
} as const;

export type SqlTemplate = keyof typeof SQL_TEMPLATE_LABELS;

export function templateSql(
  template: SqlTemplate,
  schema: string,
  name: string,
  columns: TemplateColumn[],
  kind?: DatabaseKind | null,
) {
  if (template === "select") return selectStatementSql(schema, name, columns, kind);
  if (template === "insert") return insertTemplateSql(schema, name, columns, kind);
  if (template === "update") return updateTemplateSql(schema, name, columns, kind);
  return columnListSql(columns, kind);
}
