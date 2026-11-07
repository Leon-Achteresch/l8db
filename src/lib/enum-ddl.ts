import { quoteSqlString } from "@/lib/export";
import { quoteIdent } from "@/lib/sql-filter";

const typeName = (schema: string, name: string) =>
  `${quoteIdent(schema, "postgres")}.${quoteIdent(name, "postgres")}`;
const label = (value: string) => quoteSqlString(value, "postgres");

export function enumLabels(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function createEnumSql(schema: string, name: string, labels: string[]): string {
  return `CREATE TYPE ${typeName(schema, name)} AS ENUM (${labels.map(label).join(", ")})`;
}

export function addEnumValueSql(schema: string, name: string, value: string): string {
  return `ALTER TYPE ${typeName(schema, name)} ADD VALUE ${label(value)}`;
}

export function renameEnumValueSql(schema: string, name: string, from: string, to: string): string {
  return `ALTER TYPE ${typeName(schema, name)} RENAME VALUE ${label(from)} TO ${label(to)}`;
}

export function dropEnumSql(schema: string, name: string): string {
  return `DROP TYPE ${typeName(schema, name)}`;
}
