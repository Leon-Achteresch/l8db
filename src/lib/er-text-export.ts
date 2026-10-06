import type { ERSchema, ERTable, ForeignKeyInfo } from "@/lib/db/types";

interface Relationship {
  name: string;
  from: ERTable | undefined;
  to: ERTable | undefined;
  fromSchema: string;
  fromTable: string;
  toSchema: string;
  toTable: string;
  fromColumns: string[];
  toColumns: string[];
}

function tableKey(schema: string, name: string): string {
  return JSON.stringify([schema, name]);
}

function relationships(schema: ERSchema): Relationship[] {
  const tables = new Map(schema.tables.map((table) => [tableKey(table.schema, table.name), table]));
  const groups = new Map<string, ForeignKeyInfo[]>();
  for (const fk of schema.foreign_keys) {
    const key = JSON.stringify([
      fk.from_schema,
      fk.from_table,
      fk.constraint_name,
      fk.to_schema,
      fk.to_table,
    ]);
    const group = groups.get(key);
    if (group) group.push(fk);
    else groups.set(key, [fk]);
  }
  return [...groups.values()].map((fks) => {
    const fk = fks[0];
    return {
      name: fk.constraint_name,
      from: tables.get(tableKey(fk.from_schema, fk.from_table)),
      to: tables.get(tableKey(fk.to_schema, fk.to_table)),
      fromSchema: fk.from_schema,
      fromTable: fk.from_table,
      toSchema: fk.to_schema,
      toTable: fk.to_table,
      fromColumns: fks.map((entry) => entry.from_column),
      toColumns: fks.map((entry) => entry.to_column),
    };
  });
}

function primaryKey(table: ERTable | undefined): string[] {
  return (
    table?.columns.filter((column) => column.is_primary_key).map((column) => column.name) ?? []
  );
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length > 0 && a.length === b.length && a.every((entry) => b.includes(entry));
}

function isOneToOne(relation: Relationship): boolean {
  return sameSet(relation.fromColumns, primaryKey(relation.from));
}

function isOptional(relation: Relationship): boolean {
  if (!relation.from) return false;
  return relation.fromColumns.some(
    (name) => relation.from?.columns.find((column) => column.name === name)?.is_nullable,
  );
}

function multiSchema(schema: ERSchema): boolean {
  return new Set(schema.tables.map((table) => table.schema)).size > 1;
}

export function mermaidIdentifier(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!cleaned) return "_";
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

function mermaidType(value: string): string {
  const cleaned = value
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");
  if (!cleaned) return "unknown";
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `t_${cleaned}`;
}

function mermaidText(value: string): string {
  return value.replace(/"/g, "'");
}

export function toMermaid(schema: ERSchema): string {
  const prefixed = multiSchema(schema);
  const names = new Map<string, string>();
  const used = new Set<string>();
  const entityName = (schemaName: string, table: string) => {
    const key = tableKey(schemaName, table);
    const existing = names.get(key);
    if (existing) return existing;
    const base = mermaidIdentifier(prefixed ? `${schemaName}_${table}` : table);
    let candidate = base;
    for (let index = 2; used.has(candidate); index++) candidate = `${base}_${index}`;
    used.add(candidate);
    names.set(key, candidate);
    return candidate;
  };
  const relations = relationships(schema);
  const foreignColumns = new Set(
    relations.flatMap((relation) =>
      relation.fromColumns.map((column) =>
        JSON.stringify([relation.fromSchema, relation.fromTable, column]),
      ),
    ),
  );
  const lines = ["erDiagram"];
  for (const table of schema.tables) {
    const name = entityName(table.schema, table.name);
    if (!table.columns.length) {
      lines.push(`  ${name} {`, "  }");
      continue;
    }
    lines.push(`  ${name} {`);
    for (const column of table.columns) {
      const keys = [
        column.is_primary_key ? "PK" : null,
        foreignColumns.has(JSON.stringify([table.schema, table.name, column.name])) ? "FK" : null,
      ].filter(Boolean);
      const identifier = mermaidIdentifier(column.name);
      const notes = [
        identifier !== column.name ? column.name : null,
        column.is_nullable ? "nullable" : null,
      ].filter(Boolean);
      lines.push(
        `    ${[
          mermaidType(column.data_type),
          identifier,
          keys.join(","),
          notes.length ? `"${mermaidText(notes.join(", "))}"` : "",
        ]
          .filter(Boolean)
          .join(" ")}`,
      );
    }
    lines.push("  }");
  }
  for (const relation of relations) {
    const parent = entityName(relation.toSchema, relation.toTable);
    const child = entityName(relation.fromSchema, relation.fromTable);
    const parentSide = isOptional(relation) ? "|o" : "||";
    const childSide = isOneToOne(relation) ? "o|" : "o{";
    lines.push(
      `  ${parent} ${parentSide}--${childSide} ${child} : "${mermaidText(relation.name || relation.fromColumns.join(", "))}"`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function dbmlName(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function dbmlType(value: string): string {
  const trimmed = value.trim() || "unknown";
  return /^[A-Za-z_][A-Za-z0-9_]*(\([0-9, ]*\))?(\[\])?$/.test(trimmed)
    ? trimmed
    : dbmlName(trimmed);
}

function dbmlColumns(schemaName: string, table: string, columns: string[]): string {
  const base = `${dbmlName(schemaName)}.${dbmlName(table)}`;
  return columns.length === 1
    ? `${base}.${dbmlName(columns[0])}`
    : `${base}.(${columns.map(dbmlName).join(", ")})`;
}

export function toDbml(schema: ERSchema): string {
  const blocks: string[] = [];
  for (const table of schema.tables) {
    const keys = primaryKey(table);
    const lines = [`Table ${dbmlName(table.schema)}.${dbmlName(table.name)} {`];
    for (const column of table.columns) {
      const settings = [
        column.is_primary_key && keys.length === 1 ? "pk" : null,
        column.is_nullable ? null : "not null",
      ].filter(Boolean);
      lines.push(
        `  ${dbmlName(column.name)} ${dbmlType(column.data_type)}${settings.length ? ` [${settings.join(", ")}]` : ""}`,
      );
    }
    if (keys.length > 1)
      lines.push("", "  indexes {", `    (${keys.map(dbmlName).join(", ")}) [pk]`, "  }");
    lines.push("}");
    blocks.push(lines.join("\n"));
  }
  for (const relation of relationships(schema)) {
    const label = relation.name ? ` ${dbmlName(relation.name)}` : "";
    const operator = isOneToOne(relation) ? "-" : ">";
    blocks.push(
      `Ref${label}: ${dbmlColumns(relation.fromSchema, relation.fromTable, relation.fromColumns)} ${operator} ${dbmlColumns(relation.toSchema, relation.toTable, relation.toColumns)}`,
    );
  }
  return `${blocks.join("\n\n")}\n`;
}
