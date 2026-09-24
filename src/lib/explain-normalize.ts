import type { ExplainNode } from "@/lib/db";

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function make(fields: Json, plans: ExplainNode[] = []): ExplainNode {
  const node: Json = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== "") node[key] = value;
  }
  if (plans.length > 0) node.Plans = plans;
  return node as unknown as ExplainNode;
}

function wrap(type: string, plans: ExplainNode[]): ExplainNode | null {
  if (plans.length === 0) return null;
  return plans.length === 1 ? plans[0] : make({ "Node Type": type }, plans);
}

const MYSQL_ACCESS: Record<string, string> = {
  ALL: "Full Table Scan",
  index: "Full Index Scan",
  range: "Index Range Scan",
  ref: "Index Lookup",
  eq_ref: "Unique Index Lookup",
  ref_or_null: "Index Lookup (or NULL)",
  const: "Constant Lookup",
  system: "Constant Lookup",
  fulltext: "Fulltext Lookup",
  index_merge: "Index Merge",
  unique_subquery: "Unique Subquery Lookup",
  index_subquery: "Index Subquery Lookup",
};

function mysqlCost(info: unknown, key: string): number | undefined {
  return isRecord(info) ? num(info[key]) : undefined;
}

function mysqlSubqueries(source: Json): ExplainNode[] {
  const out: ExplainNode[] = [];
  for (const key of ["attached_subqueries", "subqueries", "optimized_away_subqueries"]) {
    const list = source[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (isRecord(entry) && isRecord(entry.query_block)) {
        out.push(mysqlBlock(entry.query_block, "Subquery"));
      }
    }
  }
  return out;
}

function mysqlTable(table: Json): ExplainNode {
  const access = text(table.access_type) ?? "";
  const read = mysqlCost(table.cost_info, "read_cost");
  const evaluated = mysqlCost(table.cost_info, "eval_cost");
  const children: ExplainNode[] = [];
  const materialized = table.materialized_from_subquery;
  if (isRecord(materialized) && isRecord(materialized.query_block)) {
    children.push(mysqlBlock(materialized.query_block, "Materialize"));
  }
  children.push(...mysqlSubqueries(table));
  const keyParts = Array.isArray(table.used_key_parts) ? table.used_key_parts.join(", ") : "";
  const refs = Array.isArray(table.ref) ? table.ref.join(", ") : "";
  return make(
    {
      "Node Type": MYSQL_ACCESS[access] ?? (access ? `Table Access (${access})` : "Table Access"),
      "Relation Name": text(table.table_name),
      "Index Name": text(table.key),
      "Total Cost":
        read !== undefined || evaluated !== undefined ? (read ?? 0) + (evaluated ?? 0) : undefined,
      "Plan Rows": num(table.rows_produced_per_join),
      "Rows Examined": num(table.rows_examined_per_scan),
      "Index Cond": keyParts ? `${keyParts}${refs ? ` = ${refs}` : ""}` : undefined,
      Filter: text(table.attached_condition),
      "Access Type": access || undefined,
      "Possible Keys": Array.isArray(table.possible_keys) ? table.possible_keys : undefined,
    },
    children,
  );
}

const MYSQL_WRAPPERS: [string, (value: Json) => string][] = [
  ["ordering_operation", (v) => (v.using_filesort ? "Sort" : "Ordering")],
  ["grouping_operation", (v) => (v.using_temporary_table ? "Aggregate (temporär)" : "Aggregate")],
  ["duplicates_removal", () => "Unique"],
  ["windowing", () => "Window"],
  ["buffer_result", () => "Buffer"],
];

function mysqlOperations(source: Json): ExplainNode[] {
  for (const [key, label] of MYSQL_WRAPPERS) {
    const inner = source[key];
    if (!isRecord(inner)) continue;
    return [
      make(
        {
          "Node Type": label(inner),
          "Total Cost": mysqlCost(inner.cost_info, "sort_cost"),
          "Using Temporary Table": inner.using_temporary_table === true ? true : undefined,
          "Using Filesort": inner.using_filesort === true ? true : undefined,
        },
        [...mysqlOperations(inner), ...mysqlSubqueries(inner)],
      ),
    ];
  }
  if (Array.isArray(source.nested_loop)) {
    const tables = source.nested_loop
      .filter(isRecord)
      .flatMap((entry) =>
        isRecord(entry.table) ? [mysqlTable(entry.table)] : mysqlOperations(entry),
      );
    if (tables.length === 1) return tables;
    const last = source.nested_loop[source.nested_loop.length - 1];
    const prefix =
      isRecord(last) && isRecord(last.table)
        ? mysqlCost(last.table.cost_info, "prefix_cost")
        : undefined;
    return [make({ "Node Type": "Nested Loop", "Total Cost": prefix }, tables)];
  }
  if (isRecord(source.table)) return [mysqlTable(source.table)];
  if (isRecord(source.union_result)) {
    const union = source.union_result;
    const specs = Array.isArray(union.query_specifications) ? union.query_specifications : [];
    return [
      make(
        { "Node Type": union.using_temporary_table ? "Union (temporär)" : "Union All" },
        specs
          .filter(isRecord)
          .filter((spec) => isRecord(spec.query_block))
          .map((spec) => mysqlBlock(spec.query_block as Json, "Query Block")),
      ),
    ];
  }
  const message = text(source.message);
  if (message) return [make({ "Node Type": "Result", Message: message })];
  return [];
}

function mysqlBlock(block: Json, label: string): ExplainNode {
  const id = num(block.select_id);
  return make(
    {
      "Node Type": id !== undefined ? `${label} #${id}` : label,
      "Total Cost": mysqlCost(block.cost_info, "query_cost"),
      Message: text(block.message),
    },
    [...mysqlOperations(block), ...mysqlSubqueries(block)],
  );
}

function mysqlV2(node: Json): ExplainNode {
  const inputs = Array.isArray(node.inputs) ? node.inputs.filter(isRecord) : [];
  return make(
    {
      "Node Type": text(node.operation) ?? text(node.access_type) ?? "Operation",
      "Relation Name": text(node.table_name),
      "Index Name": text(node.index_name),
      Alias: text(node.alias),
      "Total Cost": num(node.estimated_total_cost),
      "Plan Rows": num(node.estimated_rows),
      Filter: text(node.condition),
      "Actual Total Time": num(node.actual_last_row_ms),
      "Actual Startup Time": num(node.actual_first_row_ms),
      "Actual Rows": num(node.actual_rows),
      "Actual Loops": num(node.actual_loops),
    },
    inputs.map(mysqlV2),
  );
}

const TREE_LINE = /^(\s*)->\s?(.*)$/;
const NUM = String.raw`(\d+(?:\.\d+)?(?:e[-+]?\d+)?)`;
const TREE_COST = new RegExp(String.raw`\(cost=${NUM}(?:\.\.${NUM})?\s+rows=${NUM}\)`);
const TREE_ACTUAL = new RegExp(
  String.raw`\(actual time=${NUM}\.\.${NUM}\s+rows=${NUM}\s+loops=${NUM}\)`,
);

function treeFields(label: string): Json {
  const colon = label.match(/^([A-Za-z][A-Za-z ]*?):\s+(.*)$/);
  if (colon) {
    const type = colon[1];
    const detail = colon[2];
    if (/^sort/i.test(type)) return { "Node Type": type, "Sort Key": [detail] };
    if (/^filter$/i.test(type)) return { "Node Type": type, Filter: detail };
    return { "Node Type": type };
  }
  const on = label.match(/^(.*?) on (\S+)(?: using (\S+))?(?: over \((.*)\))?(?: \((.*)\))?/);
  if (on) {
    return {
      "Node Type": on[1],
      "Relation Name": on[2],
      "Index Name": on[3],
      "Index Cond": on[4] ?? on[5],
    };
  }
  const join = label.match(/^(.*?join)\s+\((.*)\)$/i);
  if (join) return { "Node Type": join[1], "Hash Cond": join[2] };
  return { "Node Type": label };
}

function mysqlTree(raw: string): ExplainNode | null {
  const stack: { indent: number; node: Json & { Plans?: ExplainNode[] } }[] = [];
  const roots: ExplainNode[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(TREE_LINE);
    if (!match) continue;
    const indent = match[1].length;
    const body = match[2];
    const cut = body.search(/\s+\((?:cost=|actual time=|never executed)/);
    const label = (cut >= 0 ? body.slice(0, cut) : body).trim();
    const cost = body.match(TREE_COST);
    const actual = body.match(TREE_ACTUAL);
    const never = /\(never executed\)/.test(body);
    const node = make({
      ...treeFields(label),
      Description: label,
      "Startup Cost": cost && cost[2] !== undefined ? num(cost[1]) : undefined,
      "Total Cost": cost ? num(cost[2] ?? cost[1]) : undefined,
      "Plan Rows": cost ? num(cost[3]) : undefined,
      "Actual Startup Time": actual ? num(actual[1]) : never ? 0 : undefined,
      "Actual Total Time": actual ? num(actual[2]) : never ? 0 : undefined,
      "Actual Rows": actual ? num(actual[3]) : never ? 0 : undefined,
      "Actual Loops": actual ? num(actual[4]) : never ? 0 : undefined,
    }) as unknown as Json & { Plans?: ExplainNode[] };
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) {
      parent.node.Plans = [...(parent.node.Plans ?? []), node as unknown as ExplainNode];
    } else {
      roots.push(node as unknown as ExplainNode);
    }
    stack.push({ indent, node });
  }
  return wrap("Query", roots);
}

function sqliteFields(detail: string): Json {
  const scan = detail.match(
    /^(SCAN|SEARCH)\s+(?:TABLE\s+)?(\S+)(?:\s+AS\s+(\S+))?(?:\s+USING\s+(?:(COVERING)\s+)?(INDEX|INTEGER PRIMARY KEY|PRIMARY KEY)\s*([^\s(]\S*)?)?(?:\s*\((.*)\))?/i,
  );
  if (!scan) return { "Node Type": detail };
  const [, verb, table, alias, covering, via, index, cond] = scan;
  const indexed = Boolean(via);
  const type =
    verb.toUpperCase() === "SEARCH"
      ? "Index Search"
      : indexed
        ? covering
          ? "Covering Index Scan"
          : "Index Scan"
        : table.toUpperCase() === "CONSTANT"
          ? "Constant Row"
          : "Full Scan";
  return {
    "Node Type": type,
    "Relation Name": table.toUpperCase() === "CONSTANT" ? undefined : table,
    Alias: alias,
    "Index Name": index ?? (via && !/^INDEX$/i.test(via) ? via : undefined),
    "Index Cond": cond,
  };
}

function sqlite(rows: Json[]): ExplainNode | null {
  const nodes = new Map<number, Json & { Plans?: ExplainNode[] }>();
  const order: { id: number; parent: number }[] = [];
  for (const row of rows) {
    const id = num(row.id);
    const detail = text(row.detail);
    if (id === undefined || !detail) continue;
    nodes.set(id, make({ ...sqliteFields(detail), Detail: detail }) as unknown as Json);
    order.push({ id, parent: num(row.parent) ?? 0 });
  }
  const roots: ExplainNode[] = [];
  for (const { id, parent } of order) {
    const node = nodes.get(id) as unknown as ExplainNode;
    const owner = parent !== id ? nodes.get(parent) : undefined;
    if (owner) owner.Plans = [...(owner.Plans ?? []), node];
    else roots.push(node);
  }
  return wrap("Query Plan", roots);
}

function mssqlObject(argument: string): Json {
  const object = argument.match(/OBJECT:\(([^)]*)\)/);
  if (!object) return {};
  const parts = [...object[1].matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
  const alias = object[1].match(/AS \[([^\]]+)\]\s*$/)?.[1];
  const names = alias ? parts.slice(0, -1) : parts;
  if (names.length >= 4) return { "Relation Name": names[2], "Index Name": names[3], Alias: alias };
  if (names.length >= 1)
    return { "Relation Name": names[Math.min(2, names.length - 1)], Alias: alias };
  return {};
}

function mssql(rows: Json[]): ExplainNode | null {
  const statements: { key: string; node: Json & { Plans?: ExplainNode[] } }[] = [];
  const operators = new Map<string, Json & { Plans?: ExplainNode[] }>();
  const links: { key: string; parentKey: string; stmt: string }[] = [];
  for (const row of rows) {
    const stmt = String(row.StmtId ?? "1");
    const nodeId = String(row.NodeId ?? "");
    const physical = text(row.PhysicalOp);
    if (!physical || text(row.Type)?.toUpperCase() !== "PLAN_ROW") {
      statements.push({
        key: stmt,
        node: make({
          "Node Type": text(row.Type) ?? "Statement",
          Statement: text(row.StmtText),
          "Total Cost": num(row.TotalSubtreeCost),
          "Plan Rows": num(row.EstimateRows),
        }) as unknown as Json,
      });
      continue;
    }
    const logical = text(row.LogicalOp);
    const argument = text(row.Argument) ?? "";
    const where = argument.match(/WHERE:\((.*)\)\s*$/)?.[1];
    const seek = argument.match(/SEEK:\((.*?)\)(?: ORDERED|$|,)/)?.[1];
    const key = `${stmt}:${nodeId}`;
    operators.set(
      key,
      make({
        "Node Type": logical && logical !== physical ? `${physical} (${logical})` : physical,
        ...mssqlObject(argument),
        "Total Cost": num(row.TotalSubtreeCost),
        "Plan Rows": num(row.EstimateRows),
        "Plan Width": num(row.AvgRowSize),
        "Estimated Executions": num(row.EstimateExecutions),
        "Estimated IO": num(row.EstimateIO),
        "Estimated CPU": num(row.EstimateCPU),
        "Index Cond": seek,
        Filter: where,
        Argument: argument || undefined,
        "Output List": text(row.OutputList),
        Warnings: text(row.Warnings),
        Parallel:
          row.Parallel === true || row.Parallel === 1 || row.Parallel === "1" ? true : undefined,
      }) as unknown as Json,
    );
    links.push({ key, parentKey: `${stmt}:${String(row.Parent ?? "")}`, stmt });
  }
  const fallback: Json & { Plans?: ExplainNode[] } = make({
    "Node Type": "Statement",
  }) as unknown as Json;
  for (const { key, parentKey, stmt } of links) {
    const node = operators.get(key) as unknown as ExplainNode;
    const parent = parentKey !== key ? operators.get(parentKey) : undefined;
    const owner =
      parent ?? statements.find((s) => s.key === stmt)?.node ?? statements[0]?.node ?? fallback;
    owner.Plans = [...(owner.Plans ?? []), node];
  }
  const roots = statements.map((s) => s.node as unknown as ExplainNode);
  if (fallback.Plans) roots.push(fallback as unknown as ExplainNode);
  return wrap("Batch", roots);
}

export function normalizeExplainResult(raw: unknown): ExplainNode | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("->")) return mysqlTree(trimmed);
    try {
      return normalizeExplainResult(JSON.parse(trimmed));
    } catch {
      return make({ "Node Type": "Textplan", "Plan Text": trimmed });
    }
  }
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (!isRecord(first)) return null;
    if (isRecord(first.Plan)) return first.Plan as unknown as ExplainNode;
    const rows = raw.filter(isRecord);
    if ("PhysicalOp" in first || "StmtText" in first) return mssql(rows);
    if ("detail" in first) return sqlite(rows);
    return null;
  }
  if (isRecord(raw)) {
    if (isRecord(raw.Plan)) return raw.Plan as unknown as ExplainNode;
    if (isRecord(raw.query_block)) return mysqlBlock(raw.query_block, "Query Block");
    if (typeof raw.operation === "string") return mysqlV2(raw);
  }
  return null;
}
