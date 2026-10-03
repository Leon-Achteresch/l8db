export type ProcedureParamMode = "IN" | "OUT" | "INOUT" | "VARIADIC";

export interface ProcedureParam {
  name: string;
  type: string;
  mode: ProcedureParamMode;
}

const MODES: ProcedureParamMode[] = ["INOUT", "VARIADIC", "IN", "OUT"];

const TYPE_HEADS = new Set([
  "anyarray",
  "anyelement",
  "bigint",
  "bit",
  "boolean",
  "bool",
  "bytea",
  "char",
  "character",
  "date",
  "decimal",
  "double",
  "float",
  "float4",
  "float8",
  "inet",
  "int",
  "int2",
  "int4",
  "int8",
  "integer",
  "interval",
  "json",
  "jsonb",
  "money",
  "name",
  "numeric",
  "real",
  "record",
  "refcursor",
  "serial",
  "smallint",
  "text",
  "time",
  "timestamp",
  "timestamptz",
  "uuid",
  "varchar",
  "xml",
]);

const NUMERIC_TYPES =
  /^(smallint|integer|int|int2|int4|int8|bigint|numeric|decimal|real|double|float|float4|float8|serial|money|number|binary_float|binary_double)/i;

const ORACLE_SIZED_TYPES = /^(varchar2|nvarchar2|varchar|char|nchar|raw)$/i;

export function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const ch of input) {
    if (ch === '"') {
      quoted = !quoted;
      current += ch;
      continue;
    }
    if (!quoted && (ch === "(" || ch === "[")) depth += 1;
    if (!quoted && (ch === ")" || ch === "]")) depth -= 1;
    if (!quoted && depth === 0 && ch === ",") {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) parts.push(current.trim());
  return parts;
}

export function parseProcedureParams(identityArgs: string): ProcedureParam[] {
  const trimmed = identityArgs.trim();
  if (trimmed.length === 0) return [];
  return splitTopLevel(trimmed).map((raw, index) => {
    let rest = raw;
    let mode: ProcedureParamMode = "IN";
    for (const candidate of MODES) {
      const prefix = new RegExp(`^${candidate}\\s+`, "i");
      if (prefix.test(rest)) {
        mode = candidate;
        rest = rest.replace(prefix, "");
        break;
      }
    }
    const words = rest.split(/\s+/).filter(Boolean);
    if (words.length === 0) return { name: `p${index + 1}`, type: "text", mode };
    const head = (words[0] ?? "").toLowerCase().replace(/\[\]$/, "");
    if (words.length >= 2 && !TYPE_HEADS.has(head)) {
      return { name: words[0] ?? "", type: words.slice(1).join(" "), mode };
    }
    return { name: "", type: words.join(" "), mode };
  });
}

export function isNumericParam(type: string): boolean {
  return NUMERIC_TYPES.test(type.trim());
}

export function isBooleanParam(type: string): boolean {
  return /^bool(ean)?$/i.test(type.trim());
}

export function formatParamValue(type: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.toUpperCase() === "NULL") return "NULL";
  if (isNumericParam(type) && /^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(trimmed)) return trimmed;
  if (isBooleanParam(type)) return /^(true|t|1|yes)$/i.test(trimmed) ? "true" : "false";
  return `'${trimmed.replace(/'/g, "''")}'`;
}

export function buildProcedureCall(
  dialect: "postgres" | "oracle",
  schema: string,
  name: string,
  params: ProcedureParam[],
  values: Record<string, string>,
): string {
  const declarations: string[] = [];
  let inputIndex = 0;
  const args = params.map((param, index) => {
    let value: string | null = null;
    if (param.mode !== "OUT") {
      inputIndex += 1;
      value = formatParamValue(param.type, values[param.name || `p${inputIndex}`] ?? "");
    }
    if (dialect !== "oracle" || param.mode === "IN" || param.mode === "VARIADIC")
      return value ?? "NULL";
    const variable = `v${index + 1}`;
    const type = ORACLE_SIZED_TYPES.test(param.type.trim())
      ? `${param.type.trim()}(32767)`
      : param.type.trim();
    declarations.push(`${variable} ${type}${value === null ? "" : ` := ${value}`};`);
    return variable;
  });
  const target = `"${schema.replace(/"/g, '""')}"."${name.replace(/"/g, '""')}"`;
  if (dialect === "oracle") {
    const declare = declarations.length ? `DECLARE ${declarations.join(" ")} ` : "";
    return `${declare}BEGIN ${target}(${args.join(", ")}); END;`;
  }
  return `CALL ${target}(${args.join(", ")})`;
}
