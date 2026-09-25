import {
  type BindParamValue,
  buildParameterizedQuery,
  detectBindParams,
  inlineBindValues,
  type ParameterizedQuery,
} from "@/lib/bind-params";
import type { DatabaseKind } from "@/lib/db";
import type { NotebookCell } from "./model";

export function notebookVariables(
  cells: NotebookCell[],
  index: number,
): Record<string, BindParamValue> {
  const values: Record<string, BindParamValue> = {};
  for (const cell of cells.slice(0, index))
    if (cell.type === "variables")
      for (const variable of cell.variables)
        if (variable.name.trim())
          values[variable.name.trim()] = { type: variable.type, value: variable.value };
  return values;
}

const TEMPLATE = /\$\{\s*([A-Za-z_][\w]*)\s*\}/g;

export function applyTemplates(sql: string, values: Record<string, BindParamValue>): string {
  return sql.replace(TEMPLATE, (_, name: string) => {
    const entry = values[name];
    if (!entry) throw new Error(`Variable „${name}“ ist nicht definiert.`);
    return entry.type === "null" ? "NULL" : entry.value;
  });
}

export function prepareCellSql(
  source: string,
  values: Record<string, BindParamValue>,
  options: { bindParams: boolean; sqlLanguage: boolean; kind?: DatabaseKind },
): { sql: string; bound?: ParameterizedQuery } {
  const sql = applyTemplates(source, values);
  if (!options.sqlLanguage) return { sql };
  const refs = detectBindParams(sql).filter((ref) => !/^(new|old)$/i.test(ref.name));
  if (!refs.length) return { sql };
  const missing = refs.find((ref) => !values[ref.name]);
  if (missing) throw new Error(`Variable „${missing.label}“ ist nicht definiert.`);
  if (options.bindParams) return { sql, bound: buildParameterizedQuery(sql, values, options.kind) };
  return { sql: inlineBindValues(sql, values) };
}
