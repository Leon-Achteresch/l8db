import type { CatalogObject, DatabaseKind, TransferStatement } from "@/lib/db";
import { compareCatalogs } from "@/lib/schema-compare/diff";
import { buildSyncScript } from "@/lib/schema-compare/script";
import {
  type CompareResult,
  DEFAULT_COMPARE_OPTIONS,
  EMPTY_SIDE,
} from "@/lib/schema-compare/types";

export const POST_DATA_PHASE = 14;

const DROPPABLE = new Set([
  "table",
  "view",
  "materialized_view",
  "sequence",
  "function",
  "procedure",
  "package",
  "type",
  "synonym",
  "trigger",
]);

export interface NativeScript {
  preData: TransferStatement[];
  postData: TransferStatement[];
  warnings: string[];
}

export function nativeScript(
  kind: DatabaseKind,
  sourceSchema: string,
  targetSchema: string,
  objects: CatalogObject[],
): NativeScript {
  const context = {
    kind,
    sourceSchema,
    targetSchema,
    options: DEFAULT_COMPARE_OPTIONS,
  };
  const items = compareCatalogs(objects, [], context);
  const result: CompareResult = {
    ...context,
    source: EMPTY_SIDE,
    target: EMPTY_SIDE,
    sourceLabel: sourceSchema,
    targetLabel: targetSchema,
    types: [],
    items,
    comparedAt: "",
  };
  const script = buildSyncScript(result, Object.fromEntries(items.map((item) => [item.key, true])));
  const byKey = new Map(items.map((item) => [item.key, item]));
  const described = new Set<string>();
  const preData: TransferStatement[] = [];
  const postData: TransferStatement[] = [];
  for (const statement of script.statements) {
    const item = byKey.get(statement.key);
    const owner = item && DROPPABLE.has(item.type) && !described.has(item.key) ? item : null;
    if (owner) described.add(owner.key);
    const entry: TransferStatement = owner
      ? { sql: statement.sql, objectType: owner.type, schema: targetSchema, name: owner.name }
      : { sql: statement.sql, optional: /^\s*GRANT\s/i.test(statement.sql) || undefined };
    (statement.phase < POST_DATA_PHASE ? preData : postData).push(entry);
  }
  return { preData, postData, warnings: script.warnings };
}

const TABLE_PARTS = new Set(["column", "constraint", "index", "trigger", "comment", "grant"]);
const DEPENDENCIES = new Set([
  "sequence",
  "type",
  "type_body",
  "function",
  "procedure",
  "package",
  "package_body",
]);
const WORD = /[\p{L}\p{N}_$#]+/gu;

export function selectTables(
  objects: CatalogObject[],
  tables: string[] | undefined,
): { objects: CatalogObject[]; warnings: string[] } {
  if (!tables) return { objects, warnings: [] };
  const chosen = new Set(tables);
  const warnings: string[] = [];
  const kept: CatalogObject[] = [];
  const dependencies: CatalogObject[] = [];
  const candidates = new Map<string, CatalogObject[]>();
  for (const object of objects) {
    const type = object.object_type;
    if (type === "table") {
      if (chosen.has(object.name)) kept.push(object);
    } else if (DEPENDENCIES.has(type)) {
      dependencies.push(object);
      const key = object.name.toLowerCase();
      const list = candidates.get(key);
      if (list) list.push(object);
      else candidates.set(key, [object]);
    } else if (object.parent && TABLE_PARTS.has(type) && chosen.has(object.parent)) {
      const references = type === "constraint" ? object.attributes.references : undefined;
      if (!references || chosen.has(references)) kept.push(object);
      else
        warnings.push(
          `Fremdschlüssel ${object.parent}.${object.name} entfällt, weil ${references} nicht ausgewählt ist.`,
        );
    }
  }
  if (candidates.size === 0) return { objects: kept, warnings };
  const needed = new Set<CatalogObject>();
  const queue = [...kept];
  const visit = (text: string | undefined) => {
    if (!text) return;
    for (const [word] of text.matchAll(WORD)) {
      const found = candidates.get(word.toLowerCase());
      if (!found) continue;
      for (const candidate of found) {
        if (needed.has(candidate)) continue;
        needed.add(candidate);
        queue.push(candidate);
      }
    }
  };
  while (queue.length > 0) {
    const object = queue.pop() as CatalogObject;
    visit(object.ddl);
    visit(object.attributes.type);
    for (const dependency of object.depends_on ?? []) visit(dependency);
  }
  return {
    objects: [...dependencies.filter((object) => needed.has(object)), ...kept],
    warnings,
  };
}
