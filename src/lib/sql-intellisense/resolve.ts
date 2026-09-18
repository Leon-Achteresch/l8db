import type { FunctionInfo, TableInfo } from "@/lib/db";
import { type PlsqlMember, parsePlsqlMembers } from "@/lib/plsql";
import type { SqlObjectRegistry, SqlToken, Suggestion, SymbolTarget } from "./types";

export const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export const isPackage = (fn: FunctionInfo) => fn.return_type === "PACKAGE";

export function tokenAt(line: string, column: number): SqlToken | null {
  for (const match of line.matchAll(/[\w$#]+/g)) {
    const startColumn = match.index + 1;
    const endColumn = startColumn + match[0].length;
    if (column < startColumn) return null;
    if (column > endColumn) continue;
    const qualifier = /"?([\w$#]+)"?\s*\.\s*$/.exec(line.slice(0, match.index));
    return { word: match[0], qualifier: qualifier ? qualifier[1] : null, startColumn, endColumn };
  }
  return null;
}

export function aliasMap(text: string): Map<string, string> {
  const aliases = new Map<string, string>();
  const pattern =
    /(?:FROM|JOIN|UPDATE|INTO)\s+([\w"$#]+(?:\.[\w"$#]+)?)(?:\s+(?:AS\s+)?([\w$#]+))?/gi;
  for (const match of text.matchAll(pattern)) {
    const alias = match[2];
    if (
      !alias ||
      /^(WHERE|ON|SET|JOIN|LEFT|RIGHT|INNER|FULL|CROSS|GROUP|ORDER|LIMIT|USING|VALUES|SELECT)$/i.test(
        alias,
      )
    )
      continue;
    const ref = match[1].replace(/"/g, "");
    aliases.set(alias.toLowerCase(), ref.includes(".") ? ref.split(".")[1] : ref);
  }
  return aliases;
}

export function findTable(
  registry: SqlObjectRegistry,
  name: string,
  schema: string | null,
): { info: TableInfo; entityType: "table" | "view" } | null {
  const inSchema = (t: TableInfo) => eq(t.name, name) && (!schema || eq(t.schema, schema));
  const table = registry.tables.find(inSchema);
  if (table) return { info: table, entityType: "table" };
  const view = registry.views.find(inSchema);
  return view ? { info: view, entityType: "view" } : null;
}

function findRoutine(
  registry: SqlObjectRegistry,
  name: string,
  schema: string | null,
): SymbolTarget | null {
  const inSchema = (fn: FunctionInfo) => eq(fn.name, name) && (!schema || eq(fn.schema, schema));
  const pkg = registry.functions.find((fn) => isPackage(fn) && inSchema(fn));
  if (pkg) return { kind: "package", schema: pkg.schema, name: pkg.name };
  const fn = registry.functions.find((entry) => !isPackage(entry) && inSchema(entry));
  if (fn) return { kind: "function", schema: fn.schema, name: fn.name, oid: fn.oid };
  const proc = registry.procedures.find(inSchema);
  if (proc) return { kind: "procedure", schema: proc.schema, name: proc.name, oid: proc.oid };
  return null;
}

function findObject(
  registry: SqlObjectRegistry,
  name: string,
  schema: string | null,
): SymbolTarget | null {
  const routine = findRoutine(registry, name, schema);
  if (routine) return routine;
  const table = findTable(registry, name, schema);
  if (table) {
    return {
      kind: "table",
      schema: table.info.schema,
      name: table.info.name,
      entityType: table.entityType,
    };
  }
  return null;
}

export function resolveSymbol(
  registry: SqlObjectRegistry,
  token: SqlToken,
  source = "",
): SymbolTarget | null {
  if (token.qualifier) {
    const qualifier = token.qualifier;
    const pkg = registry.functions.find((fn) => isPackage(fn) && eq(fn.name, qualifier));
    if (pkg) {
      return {
        kind: "package",
        schema: pkg.schema,
        name: pkg.name,
        member: token.word.toUpperCase(),
      };
    }
    if (registry.schemas.some((schema) => eq(schema, qualifier))) {
      return findObject(registry, token.word, qualifier);
    }
    const tableName = aliasMap(source).get(qualifier.toLowerCase()) ?? qualifier;
    const table = findTable(registry, tableName, null);
    if (!table) return null;
    const column = registry.columns.find(
      (c) =>
        eq(c.schema, table.info.schema) && eq(c.table, table.info.name) && eq(c.name, token.word),
    );
    if (!column) return null;
    return {
      kind: "table",
      schema: table.info.schema,
      name: table.info.name,
      entityType: table.entityType,
      column: column.name,
    };
  }
  const local = parsePlsqlMembers(source).find((m) => m.name === token.word.toUpperCase());
  if (local) return { kind: "local", name: local.name, line: local.line, memberKind: local.kind };
  return findObject(registry, token.word, null);
}

export function packageForQualifier(
  registry: SqlObjectRegistry,
  lineBeforeCursor: string,
): FunctionInfo | null {
  const match = /"?([\w$#]+)"?\s*\.\s*[\w$#]*$/.exec(lineBeforeCursor);
  if (!match) return null;
  return registry.functions.find((fn) => isPackage(fn) && eq(fn.name, match[1])) ?? null;
}

export function memberSuggestions(members: PlsqlMember[]): Suggestion[] {
  return members.map((member) => ({
    label: member.name,
    kind: member.kind === "FUNCTION" ? "function" : "procedure",
    detail: member.kind,
    insertText: member.name,
    sortText: `0_${member.name}`,
    afterDot: true,
  }));
}
