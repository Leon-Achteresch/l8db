import { describe, expect, it, test } from "bun:test";
import {
  hoverMarkdown,
  joinSuggestions,
  joinTables,
  limitMatches,
  mayMatchWord,
  packageForQualifier,
  quoteIdent,
  resolveSymbol,
  rowsMarkdownTable,
  type SqlObjectRegistry,
  scopeAt,
  statementBounds,
  suggestCompletions,
  tokenAt,
} from "@/lib/sql-intellisense";

const registry: SqlObjectRegistry = {
  schemas: ["HR", "public"],
  tables: [
    { schema: "HR", name: "EMPLOYEES" },
    { schema: "public", name: "orders" },
  ],
  views: [{ schema: "HR", name: "EMP_V" }],
  columns: [
    { schema: "HR", table: "EMPLOYEES", name: "EMP_ID", data_type: "NUMBER" },
    { schema: "HR", table: "EMPLOYEES", name: "NAME", data_type: "VARCHAR2" },
    { schema: "public", table: "orders", name: "id", data_type: "integer" },
  ],
  functions: [
    {
      schema: "HR",
      name: "PKG_EMP",
      identity_args: "",
      return_type: "PACKAGE",
      language: "PL/SQL",
      oid: "pkg",
    },
    {
      schema: "public",
      name: "calc_total",
      identity_args: "order_id integer",
      return_type: "numeric",
      language: "plpgsql",
      oid: "fn1",
    },
  ],
  procedures: [
    {
      schema: "HR",
      name: "PROC_A",
      identity_args: "",
      return_type: "PROCEDURE",
      language: "PL/SQL",
      oid: "proc1",
    },
  ],
};

describe("tokenAt", () => {
  it("finds word and qualifier", () => {
    const token = tokenAt("  x := pkg_emp.get_name(1);", 18);
    expect(token).toEqual({
      word: "get_name",
      qualifier: "pkg_emp",
      startColumn: 16,
      endColumn: 24,
    });
  });
  it("returns null outside identifiers", () => {
    expect(tokenAt("a  b", 3)).toBeNull();
  });
});

describe("resolveSymbol", () => {
  it("resolves package member", () => {
    const target = resolveSymbol(registry, tokenAt("pkg_emp.get_name", 10)!);
    expect(target).toEqual({ kind: "package", schema: "HR", name: "PKG_EMP", member: "GET_NAME" });
  });
  it("resolves schema-qualified objects and case-insensitive names", () => {
    expect(resolveSymbol(registry, tokenAt("hr.employees", 5)!)).toMatchObject({
      kind: "table",
      name: "EMPLOYEES",
      entityType: "table",
    });
    expect(resolveSymbol(registry, tokenAt("public.calc_total", 10)!)).toMatchObject({
      kind: "function",
      oid: "fn1",
    });
  });
  it("resolves alias columns to table with column", () => {
    const source = "SELECT e.name FROM hr.employees e";
    expect(
      resolveSymbol(registry, tokenAt("SELECT e.name FROM hr.employees e", 10)!, source),
    ).toEqual({
      kind: "table",
      schema: "HR",
      name: "EMPLOYEES",
      entityType: "table",
      column: "NAME",
    });
  });
  it("prefers local members in package bodies", () => {
    const source =
      "PACKAGE BODY x IS\n  PROCEDURE proc_a IS BEGIN NULL; END;\n  BEGIN proc_a; END;";
    expect(resolveSymbol(registry, tokenAt("  BEGIN proc_a; END;", 10)!, source)).toEqual({
      kind: "local",
      name: "PROC_A",
      line: 2,
      memberKind: "PROCEDURE",
    });
    expect(resolveSymbol(registry, tokenAt("proc_a", 2)!)).toMatchObject({ kind: "procedure" });
  });
});

describe("suggestCompletions", () => {
  it("lists objects of a schema after dot", () => {
    const labels = suggestCompletions(registry, "SELECT * FROM hr.", "SELECT * FROM hr.").map(
      (s) => s.label,
    );
    expect(labels).toEqual(["EMPLOYEES", "EMP_V", "PKG_EMP", "PROC_A"]);
  });
  it("lists columns after alias dot", () => {
    const text = "SELECT e. FROM employees e";
    const labels = suggestCompletions(registry, "SELECT e.", "SELECT e.").map((s) => s.label);
    expect(labels).toEqual([]);
    const withFrom = suggestCompletions(registry, text, "SELECT e.");
    expect(withFrom.map((s) => s.label)).toEqual(["EMP_ID", "NAME"]);
  });
  it("offers db routines with snippet args in general context", () => {
    const fn = suggestCompletions(registry, "SELECT ", "SELECT ").find(
      (s) => s.label === "calc_total",
    );
    expect(fn).toMatchObject({ kind: "function", insertText: "calc_total($0)", snippet: true });
  });
  it("detects package qualifier", () => {
    expect(packageForQualifier(registry, "  pkg_emp.ge")?.name).toBe("PKG_EMP");
    expect(packageForQualifier(registry, "  hr.")).toBeNull();
  });
  it("limits shared-column documentation to the first forty tables", () => {
    const manyTables: SqlObjectRegistry = {
      ...registry,
      columns: Array.from({ length: 43 }, (_, index) => ({
        schema: "public",
        table: `table_${index}`,
        name: "status",
        data_type: "text",
      })),
    };
    const status = suggestCompletions(manyTables, "SELECT ", "SELECT ").find(
      (suggestion) => suggestion.label === "status",
    );
    expect(status?.documentation?.split("\n")).toHaveLength(41);
    expect(status?.documentation).toContain("public.table_39\n… 3 weitere");
  });
});

describe("hover", () => {
  it("renders table preview with columns and rows", () => {
    const md = hoverMarkdown(
      registry,
      { kind: "table", schema: "HR", name: "EMPLOYEES", entityType: "table" },
      { rows: { columns: ["EMP_ID"], rows: [{ EMP_ID: "1|2" }] } },
    );
    expect(md).toContain("- `EMP_ID` NUMBER");
    expect(md).toContain("| 1\\|2 |");
  });
  it("escapes and truncates cells", () => {
    expect(rowsMarkdownTable(["a"], [{ a: "x".repeat(50) }])).toContain("…");
  });
});

test("mayMatchWord keeps every candidate Monaco's fuzzy filter can match", () => {
  expect(mayMatchWord("table_0001", "")).toBe(true);
  expect(mayMatchWord("table_0001", "tbl01")).toBe(true);
  expect(mayMatchWord("order_items", "item")).toBe(true);
  expect(mayMatchWord("orderItems", "items")).toBe(true);
  expect(mayMatchWord("SELECT", "sel")).toBe(true);
  expect(mayMatchWord("customers", "stom")).toBe(false);
  expect(mayMatchWord("table_0001", "tx")).toBe(false);
});

test("limitMatches caps large lists and keeps prefix matches first", () => {
  const items = [
    ...Array.from({ length: 500 }, (_, index) => ({ label: `x_table_${index}` })),
    { label: "table_0001" },
  ];
  const limited = limitMatches(items, "tab", 10);
  expect(limited.truncated).toBe(true);
  expect(limited.items).toHaveLength(10);
  expect(limited.items[0].label).toBe("table_0001");
  expect(limitMatches(items.slice(0, 3), "", 10)).toEqual({
    items: items.slice(0, 3),
    truncated: false,
  });
});

test("limitMatches preserves order within prefix and fuzzy matches", () => {
  const items = ["x_ab", "abOne", "y_ab", "abTwo", "abThree", "z_ab"].map((label) => ({ label }));
  expect(limitMatches(items, "ab", 5)).toEqual({
    items: [items[1], items[3], items[4], items[0], items[2]],
    truncated: true,
  });
  expect(limitMatches(items, "ab", 6)).toEqual({ items, truncated: false });
  expect(limitMatches(items, "", 2)).toEqual({ items: items.slice(0, 2), truncated: true });
});

describe("quoteIdent", () => {
  it("quotes only when the dialect needs it", () => {
    expect(quoteIdent("orders", "postgres")).toBe("orders");
    expect(quoteIdent("Orders", "postgres")).toBe('"Orders"');
    expect(quoteIdent("ORDERS", "postgres")).toBe('"ORDERS"');
    expect(quoteIdent("EMPLOYEES", "oracle")).toBe("EMPLOYEES");
    expect(quoteIdent("employees", "oracle")).toBe('"employees"');
    expect(quoteIdent("_X", "oracle")).toBe('"_X"');
    expect(quoteIdent("OrderItems", "mysql")).toBe("OrderItems");
    expect(quoteIdent("order items", "mysql")).toBe("`order items`");
    expect(quoteIdent("OrderItems", "mssql")).toBe("OrderItems");
    expect(quoteIdent("order]items", "mssql")).toBe("[order]]items]");
    expect(quoteIdent("Order Items", "sqlite")).toBe('"Order Items"');
    expect(quoteIdent("OrderItems", "duckdb")).toBe("OrderItems");
    expect(quoteIdent("my-table", "clickhouse")).toBe('"my-table"');
    expect(quoteIdent("my table", "bigquery")).toBe("`my table`");
    expect(quoteIdent("MixedCase")).toBe('"MixedCase"');
  });
  it("quotes reserved words", () => {
    expect(quoteIdent("order", "postgres")).toBe('"order"');
    expect(quoteIdent("ORDER", "oracle")).toBe('"ORDER"');
    expect(quoteIdent("select", "mysql")).toBe("`select`");
    expect(quoteIdent("group", "mssql")).toBe("[group]");
  });
  it("quotes completion inserts per dialect", () => {
    const mysql: SqlObjectRegistry = {
      ...registry,
      dialect: "mysql",
      tables: [{ schema: "shop", name: "Order Items" }],
      columns: [{ schema: "shop", table: "Order Items", name: "order", data_type: "int" }],
    };
    const tables = suggestCompletions(mysql, "SELECT * FROM ", "SELECT * FROM ");
    expect(tables.find((s) => s.label === "Order Items")?.insertText).toBe("`Order Items`");
    expect(tables.find((s) => s.label === "shop.Order Items")?.insertText).toBe(
      "shop.`Order Items`",
    );
    const columns = suggestCompletions(mysql, "SELECT ", "SELECT ");
    expect(columns.find((s) => s.label === "order")?.insertText).toBe("`order`");
    const oracle = suggestCompletions({ ...registry, dialect: "oracle" }, "SELECT ", "SELECT ");
    expect(oracle.find((s) => s.label === "EMP_ID")?.insertText).toBe("EMP_ID");
    expect(oracle.find((s) => s.label === "id")?.insertText).toBe('"id"');
  });
});

function complete(marked: string, target: SqlObjectRegistry = registry) {
  const offset = marked.indexOf("|");
  const sql = marked.replace("|", "");
  const bounds = statementBounds(sql, offset, target.dialect);
  const statement = sql.slice(bounds.start, bounds.end);
  const local = offset - bounds.start;
  const before = statement.slice(0, local);
  const line = before.slice(before.lastIndexOf("\n") + 1);
  return suggestCompletions(target, before, line, [], scopeAt(statement, local, target.dialect));
}

const labels = (items: { label: string }[]) => items.map((item) => item.label);

describe("query scope", () => {
  it("offers CTE names as tables with their columns", () => {
    const items = complete(
      "WITH recent AS (SELECT o.id, count(*) cnt, sum(o.id) AS total, o.id + 1 FROM orders o)\nSELECT * FROM |",
    );
    expect(items[0]).toMatchObject({ label: "recent", kind: "table", detail: "CTE" });
    expect(items[0].documentation).toBe("id, cnt, total");
  });
  it("completes declared and derived CTE columns after an alias", () => {
    expect(
      labels(
        complete(
          "WITH a(order_id, amount) AS (SELECT id, 1 FROM orders), b AS (SELECT name AS who FROM employees)\nSELECT x.| FROM a x JOIN b y ON 1 = 1",
        ),
      ),
    ).toEqual(["order_id", "amount"]);
    expect(
      labels(
        complete(
          "WITH a(order_id, amount) AS (SELECT id, 1 FROM orders), b AS (SELECT name AS who FROM employees)\nSELECT y.| FROM a x JOIN b y ON 1 = 1",
        ),
      ),
    ).toEqual(["who"]);
  });
  it("completes derived table columns", () => {
    expect(labels(complete("SELECT x.| FROM (SELECT id AS order_id FROM orders) x"))).toEqual([
      "order_id",
    ]);
  });
  it("resolves aliases in the innermost query block first", () => {
    const sql = "SELECT * FROM employees e WHERE EXISTS (SELECT 1 FROM orders e WHERE e.|)";
    expect(labels(complete(sql))).toEqual(["id"]);
    expect(labels(complete(sql.replace("e.|)", "e.id) AND e.|")))).toEqual(["EMP_ID", "NAME"]);
  });
  it("sees outer tables in correlated subqueries", () => {
    expect(
      labels(
        complete(
          "SELECT * FROM employees e WHERE EXISTS (SELECT 1 FROM orders o WHERE o.id = e.|)",
        ),
      ),
    ).toEqual(["EMP_ID", "NAME"]);
  });
  it("isolates derived tables and CTE bodies from outer tables", () => {
    const sql = "SELECT * FROM employees e JOIN (SELECT * FROM orders WHERE |) x ON 1 = 1";
    const offset = sql.indexOf("|");
    const scope = scopeAt(sql.replace("|", ""), offset);
    expect(scope.tables.map((ref) => ref.name)).toEqual(["orders"]);
    const cte = "WITH c AS (SELECT * FROM orders WHERE |) SELECT * FROM employees, c";
    expect(scopeAt(cte.replace("|", ""), cte.indexOf("|")).tables.map((ref) => ref.name)).toEqual([
      "orders",
    ]);
  });
  it("finds the statement with the splitter instead of line endings", () => {
    const sql = "SELECT 'a;\nb' AS x, e.| FROM employees e;\nSELECT 1 FROM orders o";
    expect(labels(complete(sql))).toEqual(["EMP_ID", "NAME"]);
    expect(labels(complete("SELECT 1 FROM employees e;\nSELECT e.| FROM orders e"))).toEqual([
      "id",
    ]);
    expect(statementBounds("SELECT * FROM t WHERE   ", 24)).toEqual({ start: 0, end: 24 });
    expect(statementBounds("SELECT 1;\n\nSELECT 2", 10)).toEqual({ start: 9, end: 11 });
  });
  it("reads backtick and bracket identifiers", () => {
    const mysql = { ...registry, dialect: "mysql" as const };
    expect(labels(complete("SELECT o.| FROM `orders` AS o", mysql))).toEqual(["id"]);
    const mssql = { ...registry, dialect: "mssql" as const };
    expect(labels(complete("SELECT o.| FROM [public].[orders] o", mssql))).toEqual(["id"]);
  });
  it("keeps schema completion while typing a qualified table", () => {
    expect(labels(complete("SELECT * FROM e JOIN hr.|"))).toEqual([
      "EMPLOYEES",
      "EMP_V",
      "PKG_EMP",
      "PROC_A",
    ]);
  });
  it("resolves hover targets through the scope", () => {
    const sql =
      "SELECT e.name FROM orders e WHERE e.id IN (SELECT 1 FROM employees e WHERE e.name = '')";
    const offset = sql.lastIndexOf("e.name") + 3;
    const token = tokenAt(sql, offset + 1);
    expect(token && resolveSymbol(registry, token, sql, scopeAt(sql, offset))).toMatchObject({
      name: "EMPLOYEES",
      column: "NAME",
    });
  });
});

const shop: SqlObjectRegistry = {
  ...registry,
  dialect: "postgres",
  tables: [
    { schema: "public", name: "customers" },
    { schema: "public", name: "orders" },
    { schema: "public", name: "order_items" },
    { schema: "public", name: "order_heads" },
    { schema: "public", name: "shipments" },
    { schema: "HR", name: "EMPLOYEES" },
  ],
};

const fk = (name: string, from: string, fromColumn: string, to: string, toColumn: string) => {
  const [fromSchema, fromTable] = from.split(".");
  const [toSchema, toTable] = to.split(".");
  return {
    constraint_name: name,
    from_schema: fromSchema,
    from_table: fromTable,
    from_column: fromColumn,
    to_schema: toSchema,
    to_table: toTable,
    to_column: toColumn,
  };
};

const shopKeys = [
  fk("fk_orders_customer", "public.orders", "customer_id", "public.customers", "id"),
  fk("fk_items_order", "public.order_items", "order_id", "public.orders", "id"),
  fk("fk_items_order", "public.order_items", "order_no", "public.orders", "no"),
  fk("fk_ship_order", "public.shipments", "order_id", "public.order_heads", "order_id"),
  fk("emp_mgr", "HR.EMPLOYEES", "MANAGER_ID", "HR.EMPLOYEES", "EMP_ID"),
];

function joins(marked: string, target: SqlObjectRegistry = shop, keys = shopKeys) {
  const offset = marked.indexOf("|");
  const scope = scopeAt(marked.replace("|", ""), offset, target.dialect);
  return scope.join ? labels(joinSuggestions(target, scope.join, keys)) : null;
}

describe("join suggestions", () => {
  it("suggests foreign key conditions in both directions", () => {
    expect(joins("SELECT * FROM customers c JOIN orders o ON |")).toEqual(["o.customer_id = c.id"]);
    expect(joins("SELECT * FROM orders o LEFT JOIN customers AS c ON |")).toEqual([
      "c.id = o.customer_id",
    ]);
    expect(joins("SELECT * FROM public.customers JOIN public.orders ON |")).toEqual([
      "orders.customer_id = customers.id",
    ]);
  });
  it("joins multi-column keys with AND and deduplicates repeated metadata", () => {
    expect(
      joins("SELECT * FROM orders o JOIN order_items i ON |", shop, [...shopKeys, ...shopKeys]),
    ).toEqual(["i.order_id = o.id AND i.order_no = o.no"]);
  });
  it("offers keys to every table already in scope and skips present conditions", () => {
    expect(
      joins(
        "SELECT * FROM customers c JOIN orders o ON o.customer_id = c.id JOIN order_items i ON i|",
      ),
    ).toEqual(["i.order_id = o.id AND i.order_no = o.no"]);
    expect(joins("SELECT * FROM customers c JOIN orders o ON o.customer_id = c.id AND |")).toEqual(
      [],
    );
    expect(joins("SELECT * FROM customers c JOIN orders o ON c.id = o.customer_id AND |")).toEqual(
      [],
    );
  });
  it("suggests USING column lists only for equally named keys", () => {
    expect(joins("SELECT * FROM order_heads h JOIN shipments s USING (|")).toEqual(["order_id"]);
    expect(joins("SELECT * FROM customers c JOIN orders o USING (|")).toEqual([]);
  });
  it("handles self joins and dialect quoting", () => {
    expect(
      joins("SELECT * FROM hr.employees e JOIN hr.employees m ON |", {
        ...shop,
        dialect: "oracle",
      }),
    ).toEqual(["m.MANAGER_ID = e.EMP_ID", "m.EMP_ID = e.MANAGER_ID"]);
    expect(joins("SELECT * FROM hr.employees e JOIN hr.employees m ON |")).toEqual([
      'm."MANAGER_ID" = e."EMP_ID"',
      'm."EMP_ID" = e."MANAGER_ID"',
    ]);
  });
  it("detects joins inside CTEs and subqueries only", () => {
    expect(
      joins("WITH x AS (SELECT * FROM customers c JOIN orders o ON |) SELECT * FROM order_items"),
    ).toEqual(["o.customer_id = c.id"]);
    expect(
      joins("SELECT * FROM customers c JOIN orders o ON o.customer_id = c.id WHERE c.id = 1 AND |"),
    ).toBeNull();
    expect(joins("SELECT * FROM customers c JOIN orders o ON o.customer_id = c.id |")).toBeNull();
    expect(joins("SELECT * FROM customers c, orders o WHERE |")).toBeNull();
  });
  it("loads keys only for resolvable tables", () => {
    const sql =
      "WITH x AS (SELECT 1 AS id) SELECT * FROM x JOIN customers c ON 1 = 1 JOIN orders o JOIN orders p ON ";
    const join = scopeAt(sql, sql.length).join;
    expect(join && joinTables(shop, join).map((table) => table.name)).toEqual([
      "orders",
      "customers",
    ]);
  });
  it("ranks join conditions before every other suggestion", () => {
    const sql = "SELECT * FROM customers c JOIN orders o ON ";
    const join = scopeAt(sql, sql.length).join;
    const [first] = join ? joinSuggestions(shop, join, shopKeys) : [];
    expect(first).toMatchObject({ kind: "join", detail: "fk_orders_customer" });
    const others = complete(`${sql}|`, shop);
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((item) => item.sortText > first.sortText)).toBe(true);
  });
});

describe("review fixes", () => {
  const events: SqlObjectRegistry = {
    ...registry,
    dialect: "clickhouse",
    schemas: ["default"],
    tables: [{ schema: "default", name: "events" }],
    columns: [{ schema: "default", table: "events", name: "ts", data_type: "DateTime" }],
  };
  it("accepts keyword-like table and CTE names", () => {
    expect(labels(complete("SELECT e.| FROM default.events e", events))).toEqual(["ts"]);
    expect(labels(complete("SELECT * FROM events FINAL WHERE events.|", events))).toEqual(["ts"]);
    expect(
      labels(complete("WITH final AS (SELECT id FROM orders) SELECT f.| FROM final f")),
    ).toEqual(["id"]);
  });
  it("quotes per-dialect reserved words only", () => {
    expect(quoteIdent("desc", "postgres")).toBe('"desc"');
    expect(quoteIdent("user", "postgres")).toBe('"user"');
    expect(quoteIdent("key", "postgres")).toBe("key");
    expect(quoteIdent("date", "postgres")).toBe("date");
    expect(quoteIdent("key", "mysql")).toBe("`key`");
    expect(quoteIdent("COMMENT", "oracle")).toBe('"COMMENT"');
    expect(quoteIdent("user", "mssql")).toBe("[user]");
    expect(quoteIdent("column", "sqlite")).toBe('"column"');
  });
  it("skips index hints and locking clauses instead of reading them as aliases", () => {
    const mysql = { ...registry, dialect: "mysql" as const };
    const sql =
      "SELECT * FROM orders o USE INDEX (idx_a) JOIN employees e FORCE KEY FOR JOIN (i) ON |";
    const scope = scopeAt(sql, sql.length, "mysql");
    expect(scope.tables.map((ref) => ref.alias)).toEqual(["o", "e"]);
    expect(labels(complete("SELECT o.| FROM orders o IGNORE INDEX (idx_a)", mysql))).toEqual([
      "id",
    ]);
    const locked = "SELECT * FROM orders o WHERE o.id = 1 FOR UPDATE OF o NOWAIT";
    expect(scopeAt(locked, 20).tables.map((ref) => ref.name)).toEqual(["orders"]);
  });
  it("keeps derived tables in extra parentheses isolated", () => {
    const sql = "SELECT * FROM employees e JOIN ((SELECT * FROM orders WHERE |)) x ON 1 = 1";
    const scope = scopeAt(sql.replace("|", ""), sql.indexOf("|"));
    expect(scope.tables.map((ref) => ref.name)).toEqual(["orders"]);
  });
  it("treats LEFT( and RIGHT( as functions inside join conditions", () => {
    expect(
      joins("SELECT * FROM customers c JOIN orders o ON LEFT(o.code, 2) = RIGHT(c.code, 2) AND |"),
    ).toEqual(["o.customer_id = c.id"]);
  });
  it("does not derive column names from keywords", () => {
    expect(
      labels(
        complete(
          "WITH x AS (SELECT CASE WHEN id > 1 THEN 1 END, NULL, TRUE, id, 2 AS hash FROM orders) SELECT x.| FROM x",
        ),
      ),
    ).toEqual(["id", "hash"]);
  });
  it("reads backslash escapes in MySQL strings", () => {
    const mysql = { ...registry, dialect: "mysql" as const };
    expect(labels(complete("SELECT 'O\\'Brien' AS n, o.| FROM orders o", mysql))).toEqual(["id"]);
  });
  it("prefers aliases over packages with the same name", () => {
    const sql = "SELECT pkg_emp. FROM orders pkg_emp";
    const scope = scopeAt(sql, 15);
    expect(packageForQualifier(registry, "SELECT pkg_emp.", scope)).toBeNull();
    expect(packageForQualifier(registry, "SELECT pkg_emp.")?.name).toBe("PKG_EMP");
  });
});
