import type { CompileErrorInfo, InvalidObjectInfo } from "@/lib/db";

export function invalidKey(schema: string, name: string, objectType: string): string {
  return `${schema.toUpperCase()}.${name.toUpperCase()}.${objectType.toUpperCase()}`;
}

export function buildInvalidSet(items: InvalidObjectInfo[] | undefined): Set<string> {
  const set = new Set<string>();
  if (!items) return set;
  for (const item of items) {
    set.add(invalidKey(item.schema, item.name, item.object_type));
  }
  return set;
}

export function isInvalid(
  set: Set<string>,
  schema: string,
  name: string,
  types: string[],
): boolean {
  return types.some((t) => set.has(invalidKey(schema, name, t)));
}

export function isFunctionInvalid(set: Set<string>, schema: string, name: string): boolean {
  return isInvalid(set, schema, name, ["FUNCTION"]);
}

export function isProcedureInvalid(set: Set<string>, schema: string, name: string): boolean {
  return isInvalid(set, schema, name, ["PROCEDURE"]);
}

export function isPackageInvalid(set: Set<string>, schema: string, name: string): boolean {
  return isInvalid(set, schema, name, ["PACKAGE", "PACKAGE BODY"]);
}

export function isPackagePartInvalid(
  set: Set<string>,
  schema: string,
  name: string,
  part: "spec" | "body",
): boolean {
  return part === "spec"
    ? isInvalid(set, schema, name, ["PACKAGE"])
    : isInvalid(set, schema, name, ["PACKAGE BODY"]);
}

export function isViewInvalid(set: Set<string>, schema: string, name: string): boolean {
  return isInvalid(set, schema, name, ["VIEW", "MATERIALIZED VIEW"]);
}

export function isTriggerInvalid(set: Set<string>, schema: string, name: string): boolean {
  return isInvalid(set, schema, name, ["TRIGGER"]);
}

export function isSynonymTargetInvalid(status: string): boolean {
  return status.toUpperCase() !== "VALID";
}

export function countInvalid(items: InvalidObjectInfo[] | undefined): number {
  return items?.length ?? 0;
}

export const INVALID_GROUP_TYPES: Record<string, string[]> = {
  functions: ["FUNCTION"],
  procedures: ["PROCEDURE"],
  packages: ["PACKAGE", "PACKAGE BODY"],
  views: ["VIEW", "MATERIALIZED VIEW"],
};

export function filterInvalidByTypes(
  items: InvalidObjectInfo[] | undefined,
  types: string[],
): InvalidObjectInfo[] {
  if (!items) return [];
  const wanted = new Set(types.map((t) => t.toUpperCase()));
  return items.filter((item) => wanted.has(item.object_type.toUpperCase()));
}

export function compileArgForInvalidType(objectType: string): string {
  const t = objectType.toUpperCase();
  if (t === "PACKAGE") return "package_spec";
  if (t === "PACKAGE BODY") return "package_body";
  if (t === "FUNCTION") return "function";
  if (t === "PROCEDURE") return "procedure";
  if (t === "TRIGGER") return "trigger";
  if (t === "VIEW" || t === "MATERIALIZED VIEW") return "view";
  if (t === "TYPE") return "type";
  if (t === "TYPE BODY") return "type_body";
  return "routine";
}

export const INVALID_RENDER_STEP = 200;
export const INVALID_ERRORS_PER_OBJECT = 20;

const INVALID_TYPE_LABELS: Record<string, string> = {
  PACKAGE: "Package",
  "PACKAGE BODY": "Package Body",
  FUNCTION: "Funktion",
  PROCEDURE: "Prozedur",
  VIEW: "View",
  "MATERIALIZED VIEW": "Mat. View",
  TRIGGER: "Trigger",
  TYPE: "Typ",
  "TYPE BODY": "Type Body",
  SYNONYM: "Synonym",
};

export function invalidTypeLabel(objectType: string): string {
  return INVALID_TYPE_LABELS[objectType.toUpperCase()] ?? objectType;
}

export function parseCompileMessage(message: string): { code: string | null; text: string } {
  const match = /^([A-Z]{3}-\d{5}):\s*([\s\S]*)$/.exec(message);
  return match ? { code: match[1], text: match[2] } : { code: null, text: message };
}

export interface InvalidProblem {
  item: InvalidObjectInfo;
  errors: CompileErrorInfo[];
}

export interface InvalidProblemSet {
  problems: InvalidProblem[];
  others: CompileErrorInfo[];
  matched: number;
}

export function buildInvalidProblems(
  items: InvalidObjectInfo[],
  errors: CompileErrorInfo[],
): InvalidProblemSet {
  const byKey = new Map<string, CompileErrorInfo[]>();
  for (const error of errors) {
    const key = invalidKey(error.schema, error.name, error.object_type);
    const list = byKey.get(key);
    if (list) list.push(error);
    else byKey.set(key, [error]);
  }
  const used = new Set<string>();
  let matched = 0;
  const problems = items.map((item) => {
    const key = invalidKey(item.schema, item.name, item.object_type);
    const list = byKey.get(key) ?? [];
    if (!used.has(key)) {
      used.add(key);
      matched += list.length;
    }
    return { item, errors: list };
  });
  const others: CompileErrorInfo[] = [];
  for (const [key, list] of byKey) {
    if (used.has(key)) continue;
    for (const error of list) others.push(error);
  }
  return { problems, others, matched };
}

export function invalidTypeLabels(items: InvalidObjectInfo[]): string[] {
  return [...new Set(items.map((item) => invalidTypeLabel(item.object_type)))];
}

export function filterInvalidProblems(
  problems: InvalidProblem[],
  typeLabel: string | null,
  query: string,
): InvalidProblem[] {
  const needle = query.trim().toLowerCase();
  if (!typeLabel && !needle) return problems;
  return problems.filter(
    ({ item }) =>
      (!typeLabel || invalidTypeLabel(item.object_type) === typeLabel) &&
      (!needle || `${item.schema}.${item.name}`.toLowerCase().includes(needle)),
  );
}
