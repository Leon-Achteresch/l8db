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
      : { sql: statement.sql };
    (statement.phase < POST_DATA_PHASE ? preData : postData).push(entry);
  }
  return { preData, postData, warnings: script.warnings };
}
