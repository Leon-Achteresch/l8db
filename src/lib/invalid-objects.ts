import type { InvalidObjectInfo } from "@/lib/db";

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
