import { describe, expect, test } from "bun:test";
import {
  compactError,
  compactExplain,
  compactResult,
  truncateValue,
} from "@/lib/ai/editor/compact";
import { applyModelEdit, stripFences } from "@/lib/ai/editor/edit-format";
import { compactHistory, type HistoryMessage, historyNeedsSummary } from "@/lib/ai/editor/history";
import { applyHunks, diffLines } from "@/lib/ai/editor/line-diff";
import { redactSecrets } from "@/lib/ai/editor/redact";
import {
  compactTable,
  rankTables,
  referencedTables,
  relevantSchema,
  type SchemaSource,
  schemaOverview,
  shortType,
} from "@/lib/ai/editor/schema-context";
import { completionWindow, statementContext } from "@/lib/ai/editor/sql-context";
import type { ColumnInfo, ForeignKeyInfo, TableInfo } from "@/lib/db/types";

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function shuffled<T>(items: T[], seed: number): T[] {
  const next = random(seed);
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(next() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function column(schema: string, table: string, name: string, data_type: string): ColumnInfo {
  return { schema, table, name, data_type };
}

function fk(
  from_schema: string,
  from_table: string,
  from_column: string,
  to_schema: string,
  to_table: string,
  to_column: string,
): ForeignKeyInfo {
  return {
    constraint_name: `${from_table}_${from_column}_fkey`,
    from_schema,
    from_table,
    from_column,
    to_schema,
    to_table,
    to_column,
  };
}

const tables: TableInfo[] = [
  { schema: "public", name: "orders" },
  { schema: "public", name: "order_items" },
  { schema: "public", name: "customers" },
  { schema: "public", name: "products" },
  { schema: "public", name: "categories" },
  { schema: "public", name: "orgs" },
  { schema: "public", name: "users" },
  { schema: "sales", name: "orders" },
  { schema: "sales", name: "targets" },
  { schema: "audit", name: "log" },
];
const views: TableInfo[] = [{ schema: "public", name: "order_totals" }];
const columns: ColumnInfo[] = [
  column("public", "users", "id", "integer"),
  column("public", "users", "email", "character varying(255)"),
  column("public", "users", "org_id", "integer"),
  column("public", "users", "created_at", "timestamp with time zone"),
  column("public", "orgs", "id", "integer"),
  column("public", "orgs", "name", "text"),
  column("public", "orders", "id", "bigint"),
  column("public", "orders", "customer_id", "integer"),
  column("public", "orders", "total", "double precision"),
  column("public", "orders", "placed_at", "timestamp without time zone"),
  column("public", "order_items", "order_id", "bigint"),
  column("public", "order_items", "product_id", "integer"),
  column("public", "customers", "id", "integer"),
  column("sales", "orders", "id", "integer"),
  column("sales", "orders", "user_id", "integer"),
];
const foreignKeys: ForeignKeyInfo[] = [
  fk("public", "users", "org_id", "public", "orgs", "id"),
  fk("public", "orders", "customer_id", "public", "customers", "id"),
  fk("public", "order_items", "order_id", "public", "orders", "id"),
  fk("public", "order_items", "product_id", "public", "products", "id"),
  fk("sales", "orders", "user_id", "public", "users", "id"),
];
const source: SchemaSource = { tables, views, columns };

function names(list: TableInfo[]) {
  return list.map((table) => `${table.schema}.${table.name}`);
}

describe("schemaOverview", () => {
  test("groups per schema, default schema first, views prefixed", () => {
    expect(schemaOverview(source, { defaultSchema: "public" })).toBe(
      [
        "public: categories, customers, order_items, v:order_totals, orders, orgs, products, users",
        "audit: log",
        "sales: orders, targets",
      ].join("\n"),
    );
    expect(schemaOverview(source).split("\n")[0]).toBe("audit: log");
  });

  test("is identical for shuffled input", () => {
    const expected = schemaOverview(source, { defaultSchema: "sales" });
    for (let seed = 1; seed <= 5; seed++) {
      const copy = {
        tables: shuffled(tables, seed),
        views: shuffled(views, seed),
        columns: shuffled(columns, seed),
      };
      expect(schemaOverview(copy, { defaultSchema: "sales" })).toBe(expected);
    }
  });

  test("caps output and counts the missing objects", () => {
    const many: TableInfo[] = Array.from({ length: 500 }, (_, index) => ({
      schema: `s${index % 3}`,
      name: `table_${String(index).padStart(4, "0")}`,
    }));
    const text = schemaOverview({ tables: many, views: [], columns: [] }, { maxChars: 300 });
    expect(text.length).toBeLessThanOrEqual(300);
    const match = /… \+(\d+) weitere Objekte$/.exec(text);
    expect(match).not.toBeNull();
    const shown = text
      .split("\n")
      .slice(0, -1)
      .flatMap((line) => line.replace(/^[^:]+: /, "").split(", ")).length;
    expect(shown + Number(match?.[1])).toBe(500);
  });
});

describe("referencedTables", () => {
  test("finds qualified, bare and quoted names case-insensitively", () => {
    expect(names(referencedTables("select * from sales.orders", source))).toEqual(["sales.orders"]);
    expect(names(referencedTables('SELECT * FROM "Orders" o JOIN `users` u', source))).toEqual([
      "public.orders",
      "public.users",
      "sales.orders",
    ]);
    expect(names(referencedTables("select * from [audit].[log]", source))).toEqual(["audit.log"]);
  });

  test("ignores string literals and comments", () => {
    const sql =
      "-- from users\nselect 'orders' as x, /* customers */ 1 from products where note = 'it''s orgs'";
    expect(names(referencedTables(sql, source))).toEqual(["public.products"]);
  });

  test("treats table.column references as table usage", () => {
    expect(names(referencedTables("select orgs.name from x", source))).toEqual(["public.orgs"]);
  });
});

describe("rankTables", () => {
  test("ranks SQL references, prompt names, FK neighbours and recent tables", () => {
    const ranked = rankTables(
      source,
      {
        sql: "select * from public.users",
        prompt: "join the order items and categories",
        recent: ["audit.log"],
        foreignKeys,
        defaultSchema: "public",
      },
      12,
    );
    expect(names(ranked)).toEqual([
      "public.users",
      "public.categories",
      "public.order_items",
      "public.orgs",
      "sales.orders",
      "audit.log",
    ]);
  });

  test("maps singular/plural and snake_case parts but not translations", () => {
    const order = rankTables(source, {
      sql: "",
      prompt: "show each order",
      defaultSchema: "public",
    });
    expect(names(order)).toEqual(["public.orders", "sales.orders"]);
    expect(rankTables(source, { sql: "", prompt: "alle Bestellungen" })).toEqual([]);
    expect(names(rankTables(source, { sql: "", prompt: "OrderItems" }))).toEqual([
      "public.order_items",
    ]);
    expect(names(rankTables(source, { sql: "", prompt: "category" }))).toEqual([
      "public.categories",
    ]);
  });

  test("respects the limit and is deterministic", () => {
    const input = { sql: "select * from orders, users, orgs, customers", defaultSchema: "public" };
    expect(rankTables(source, input, 2)).toHaveLength(2);
    const expected = names(rankTables(source, input));
    const copy = { tables: shuffled(tables, 9), views, columns };
    expect(names(rankTables(copy, input))).toEqual(expected);
  });
});

describe("compactTable and relevantSchema", () => {
  test("shortens types and shows FK targets", () => {
    expect(compactTable(tables[6], columns, foreignKeys)).toBe(
      "public.users(id int4, email varchar(255), org_id int4→orgs.id, created_at timestamptz)",
    );
    expect(compactTable({ schema: "sales", name: "orders" }, columns, foreignKeys)).toBe(
      "sales.orders(id int4, user_id int4→public.users.id)",
    );
  });

  test("documents the type aliases", () => {
    expect(
      [
        "character varying",
        "character(3)",
        "timestamp without time zone",
        "timestamp(3) with time zone",
        "time with time zone",
        "double precision",
        "integer",
        "smallint",
        "bigint",
        "real",
        "boolean",
        "integer[]",
        "numeric(10,2)",
        "enum('a','b','c','d','e')",
        "NVARCHAR(MAX)",
      ].map(shortType),
    ).toEqual([
      "varchar",
      "char(3)",
      "timestamp",
      "timestamptz(3)",
      "timetz",
      "float8",
      "int4",
      "int2",
      "int8",
      "float4",
      "bool",
      "int4[]",
      "numeric(10,2)",
      "enum('a','b','c',…)",
      "NVARCHAR(MAX)",
    ]);
  });

  test("drops the default schema and lists overflowing tables by name", () => {
    const text = relevantSchema(source, [tables[6], tables[7], tables[5]], {
      foreignKeys,
      defaultSchema: "public",
    });
    expect(text).toBe(
      [
        "users(id int4, email varchar(255), org_id int4→orgs.id, created_at timestamptz)",
        "sales.orders(id int4, user_id int4→users.id)",
        "orgs(id int4, name text)",
      ].join("\n"),
    );
    const capped = relevantSchema(source, [tables[6], tables[7], tables[5]], {
      foreignKeys,
      defaultSchema: "public",
      maxChars: 110,
    });
    expect(capped.length).toBeLessThanOrEqual(110);
    expect(capped).toBe(
      "users(id int4, email varchar(255), org_id int4→orgs.id, created_at timestamptz)\n+ weitere: sales.orders, orgs",
    );
  });

  test("truncates the columns of a single huge first table", () => {
    const wide = Array.from({ length: 400 }, (_, index) =>
      column("public", "wide", `column_${index}`, "integer"),
    );
    const text = relevantSchema(
      { tables: [{ schema: "public", name: "wide" }], views: [], columns: wide },
      [{ schema: "public", name: "wide" }],
      { maxChars: 500 },
    );
    expect(text.length).toBeLessThanOrEqual(500);
    expect(text).toMatch(/^public\.wide\(column_0 int4, .*…\+\d+\)$/);
  });
});

describe("sql context", () => {
  const sql = "select 1;\nselect 2 from users;\n\nselect 3;";

  test("returns the statement at the cursor and its neighbours", () => {
    const context = statementContext(sql, sql.indexOf("users"));
    expect(context.statement).toBe("select 2 from users;");
    expect(context.before).toBe("select 1;");
    expect(context.after).toBe("select 3;");
    expect(sql.slice(context.start, context.end)).toBe(context.statement);
  });

  test("uses the previous statement between statements and handles unterminated tails", () => {
    expect(statementContext(sql, sql.indexOf("\n\n") + 1).statement).toBe("select 2 from users;");
    expect(statementContext("select 1; select 'x", 15).statement).toBe("select 'x");
    expect(statementContext("   ", 1).statement).toBe("");
  });

  test("truncates neighbours to the budget", () => {
    const long = `${Array.from({ length: 200 }, (_, index) => `select ${index};`).join("\n")}`;
    const context = statementContext(long, long.indexOf("select 100;"), { maxChars: 200 });
    expect(context.statement).toBe("select 100;");
    expect(context.before.startsWith("…")).toBe(true);
    expect(context.after.endsWith("…")).toBe(true);
    expect(
      context.statement.length + context.before.length + context.after.length,
    ).toBeLessThanOrEqual(200);
  });

  test("completion window cuts at line boundaries", () => {
    const text = Array.from({ length: 100 }, (_, index) => `line ${index}`).join("\n");
    const offset = text.indexOf("line 50") + 4;
    const { prefix, suffix } = completionWindow(text, offset, { before: 30, after: 30 });
    expect(prefix.startsWith("line ")).toBe(true);
    expect(prefix.endsWith("line")).toBe(true);
    expect(suffix.startsWith(" 50")).toBe(true);
    expect(suffix.endsWith("\n")).toBe(false);
    expect(prefix.length).toBeLessThanOrEqual(30);
    expect(suffix.length).toBeLessThanOrEqual(30);
    expect(completionWindow("abc", 1)).toEqual({ prefix: "a", suffix: "bc" });
  });
});

describe("compact values and results", () => {
  test("truncateValue", () => {
    expect(truncateValue(null)).toBe("NULL");
    expect(truncateValue(undefined)).toBe("NULL");
    expect(truncateValue(new Uint8Array(12))).toBe("<binary 12 bytes>");
    expect(truncateValue({ a: 1 })).toBe('{"a":1}');
    expect(truncateValue("x".repeat(100), 10)).toBe("xxxxxxxxxx…(+90 chars)");
    expect(truncateValue(`${"a".repeat(9)}😀b`, 10)).toBe("aaaaaaaaa…(+3 chars)");
    expect(truncateValue(12n)).toBe("12");
  });

  const result = {
    columns: ["id", "email", "score", "created", "meta", "flag"],
    rows: Array.from({ length: 50 }, (_, index) => ({
      id: index + 1,
      email: index % 10 === 0 ? null : `secret-user-${index}@example.com`,
      score: index + 0.5,
      created: `2024-01-${String((index % 28) + 1).padStart(2, "0")}`,
      meta: { tag: index % 3 },
      flag: index % 2 === 0,
    })),
    totalRows: 1234,
    truncated: true,
  };

  test("summarises columns without any cell values by default", () => {
    const text = compactResult(result);
    expect(text).toBe(
      [
        "50 Zeilen von 1234, 6 Spalten, gekürzt",
        "- id: int, 50 distinct (unique)",
        "- email: text, 10% NULL, 45 distinct (unique), len 25–26",
        "- score: number, 50 distinct (unique)",
        "- created: date, 28 distinct",
        "- meta: json, 3 distinct",
        "- flag: bool, 2 distinct",
      ].join("\n"),
    );
    expect(text).not.toContain("secret-user");
    expect(text).not.toContain("2024");
    expect(text).not.toContain("0.5");
  });

  test("includes ranges and sample rows only when asked", () => {
    const text = compactResult(result, { includeValues: true, sampleRows: 2, maxCell: 12 });
    expect(text).toContain("- id: int, 50 distinct (unique), 1…50");
    expect(text).toContain("2024-01-01…2024-01-28");
    expect(text).toContain("Beispielzeilen (2):");
    expect(text.split("\n").at(-1)).toBe(
      '2\tsecret-user-…(+13 chars)\t1.5\t2024-01-02\t{"tag":1}\tfalse',
    );
  });

  test("samples deterministically beyond 10 000 rows", () => {
    const rows = Array.from({ length: 50_000 }, (_, index) => ({ v: index % 20_000 }));
    const text = compactResult({ columns: ["v"], rows });
    expect(text).toContain("- v: int, ≥");
    expect(compactResult({ columns: ["v"], rows })).toBe(text);
  });
});

describe("compactExplain", () => {
  const plan = [
    {
      Plan: {
        "Node Type": "Hash Join",
        "Join Type": "Inner",
        "Total Cost": 1000,
        "Plan Rows": 100,
        "Actual Rows": 5000,
        "Actual Total Time": 50,
        "Actual Loops": 1,
        "Hash Cond": "(o.customer_id = c.id)",
        Plans: [
          {
            "Node Type": "Seq Scan",
            "Relation Name": "orders",
            Alias: "o",
            "Total Cost": 800,
            "Plan Rows": 10000,
            "Actual Rows": 10000,
            "Actual Total Time": 40,
            "Actual Loops": 1,
            Filter: "(status = 'open'::text)",
            "Rows Removed by Filter": 12,
          },
          {
            "Node Type": "Index Scan",
            "Relation Name": "customers",
            "Index Name": "customers_pkey",
            "Total Cost": 5,
            "Plan Rows": 1,
            "Actual Rows": 1,
            "Actual Total Time": 0.2,
            "Actual Loops": 1,
          },
        ],
      },
    },
  ];

  test("renders relevant nodes, marks misestimates and hides tiny nodes", () => {
    expect(compactExplain(plan)).toBe(
      [
        "Hash Join cost=1000 rows 100→5000 !rows time=50ms cond=(o.customer_id = c.id)",
        "  Seq Scan on orders o cost=800 rows 10000→10000 time=40ms filter=(status = 'open'::text) removed=12",
        "… 1 Knoten unter 2% ausgelassen",
      ].join("\n"),
    );
    expect(compactExplain(plan, { minShare: 0 })).toContain(
      "Index Scan on customers [customers_pkey]",
    );
    expect(compactExplain(plan, { minShare: 0, maxNodes: 1 })).toContain(
      "… 2 weitere Knoten (Limit 1)",
    );
  });

  test("works for normalised MySQL plans and unknown input", () => {
    const mysql = {
      query_block: {
        cost_info: { query_cost: "10.5" },
        table: { table_name: "users", access_type: "ALL", rows_examined_per_scan: 100 },
      },
    };
    expect(compactExplain(mysql)).toContain("users");
    expect(compactExplain({ foo: "x".repeat(10_000) }).length).toBeLessThanOrEqual(4001);
    expect(compactExplain(42)).toBe("42");
  });
});

describe("compactError", () => {
  test("shows the offending line with a caret", () => {
    const sql = "select\n  id,\n  nme\nfrom users\nwhere 1 = 1";
    const position = sql.indexOf("nme") + 1;
    expect(
      compactError(sql, { message: 'column "nme" does not exist', code: "42703", position }, 1),
    ).toBe(
      [
        'Fehler [42703]: column "nme" does not exist',
        "2 |   id,",
        "3 |   nme",
        "  |   ^",
        "4 | from users",
      ].join("\n"),
    );
  });

  test("uses line numbers, drops stack lines and truncates", () => {
    const text = compactError("a\nb\nc", {
      message: `boom\n    at foo (x.js:1:1)\n${"y".repeat(1000)}`,
      line: 3,
    });
    expect(text).not.toContain("at foo");
    expect(text.split("\n")[0].length).toBeLessThanOrEqual(620);
    expect(text).toContain("3 | c");
    expect(compactError("", { message: "x" })).toBe("Fehler: x");
  });
});

describe("redactSecrets", () => {
  test("masks credentials", () => {
    const cases: [string, string][] = [
      ["postgres://admin:hunter2@db:5432/x", "postgres://admin:***@db:5432/x"],
      ["mysql://u:p@ss@host/db", "mysql://u:***@host/db"],
      ["host=db password=hunter2 user=x", "host=db password=*** user=x"],
      ["Server=x;Pwd=abc123;", "Server=x;Pwd=***;"],
      ['{"password": "s3cr3t", "user": "a"}', '{"password": "***", "user": "a"}'],
      ["api_key='abc'", "api_key='***'"],
      ["CREATE USER bob IDENTIFIED BY 'pw';", "CREATE USER bob IDENTIFIED BY '***';"],
      ["CREATE USER bob IDENTIFIED BY tiger;", "CREATE USER bob IDENTIFIED BY ***;"],
      ["ALTER ROLE bob WITH PASSWORD 'pw'", "ALTER ROLE bob WITH PASSWORD '***'"],
      ["Authorization: Bearer abc.def.ghi", "Authorization: Bearer ***"],
      ["key sk-ant-api03-abcdefghijklmnop", "key ***"],
      ["sk-abcdefghijklmnopqrstuvwx", "***"],
      ["AKIAABCDEFGHIJKLMNOP", "***"],
      ["ghp_abcdefghijklmnopqrstuvwxyz0123", "***"],
      ["github_pat_11ABCDEFG0123456789_abcdef", "***"],
      ["xoxb-1234567890-abcdef", "***"],
      ["AIzaSyA1234567890abcdefghijklmnopqrstuv", "***"],
      ["password: hunter2", "password: ***"],
    ];
    for (const [input, expected] of cases) expect(redactSecrets(input)).toBe(expected);
  });

  test("leaves ordinary SQL untouched", () => {
    const queries = [
      "SELECT id, password_hash, token_count FROM users WHERE id = $1",
      "SELECT * FROM sessions WHERE token = $1 AND user_id = :user",
      "UPDATE users SET password_changed_at = now() WHERE id = ?",
      "SELECT 'http://example.com/path' AS url, a.b FROM t a JOIN s b ON a.id = b.id",
      "CREATE TABLE secrets (id int, secret_value text);",
      "SELECT task-1 FROM risk_assessment",
      "SELECT x::int, y FROM t WHERE created_at > now() - interval '1 day'",
    ];
    for (const query of queries) expect(redactSecrets(query)).toBe(query);
  });

  test("is linear on large adversarial input", () => {
    const parts = [
      "a".repeat(200_000),
      "password=".repeat(20_000),
      "postgres://".repeat(10_000),
      "IDENTIFIED BY '".repeat(10_000),
      "password = '".repeat(10_000),
      "-----BEGIN PRIVATE KEY-----".repeat(1_000),
    ];
    const input = parts.join(" ").slice(0, 1_000_000);
    const start = performance.now();
    redactSecrets(input);
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe("applyModelEdit", () => {
  const original = "select id,\n  name\nfrom users\nwhere active;\n";

  test("applies exact blocks and keeps the line ending style", () => {
    const output =
      "Here you go:\n```\n<<<<<<< SEARCH\n  name\n=======\n  name,\n  email\n>>>>>>> REPLACE\n```";
    expect(applyModelEdit(original, output)).toEqual({
      ok: true,
      mode: "blocks",
      text: "select id,\n  name,\n  email\nfrom users\nwhere active;\n",
    });
    const crlf = original.replace(/\n/g, "\r\n");
    const result = applyModelEdit(crlf, output);
    expect(result.ok && result.text).toBe(
      "select id,\r\n  name,\r\n  email\r\nfrom users\r\nwhere active;\r\n",
    );
  });

  test("matches fuzzily on whitespace and re-indents", () => {
    const text = "begin\n    update t   \n    set a = 1;\nend;";
    const trailing = applyModelEdit(
      text,
      "<<<<<<< SEARCH\n    update t\n=======\n    update t2\n>>>>>>> REPLACE",
    );
    expect(trailing.ok && trailing.text).toBe("begin\n    update t2\n    set a = 1;\nend;");
    const indented = applyModelEdit(
      text,
      "<<<<<<< SEARCH\nupdate t\nset a = 1;\n=======\nupdate t\nset a = 2\n  where id = 1;\n>>>>>>> REPLACE",
    );
    expect(indented.ok && indented.text).toBe(
      "begin\n    update t\n    set a = 2\n      where id = 1;\nend;",
    );
  });

  test("applies multiple blocks sequentially and supports append", () => {
    const output = [
      "<<<<<<< SEARCH",
      "from users",
      "=======",
      "from people",
      ">>>>>>> REPLACE",
      "<<<<<<< SEARCH",
      "=======",
      "select 2;",
      ">>>>>>> REPLACE",
    ].join("\n");
    const result = applyModelEdit(original, output);
    expect(result.ok && result.text).toBe(
      "select id,\n  name\nfrom people\nwhere active;\nselect 2;\n",
    );
    const empty = applyModelEdit("", "<<<<<<< SEARCH\n=======\nselect 1;\n>>>>>>> REPLACE");
    expect(empty.ok && empty.text).toBe("select 1;");
  });

  test("reports missing, ambiguous and malformed blocks in German", () => {
    const missing = applyModelEdit(
      original,
      "<<<<<<< SEARCH\nfrom orders\n=======\nx\n>>>>>>> REPLACE",
    );
    expect(missing).toEqual({
      ok: false,
      error: 'SEARCH-Block 1 wurde nicht gefunden: "from orders"',
    });
    const ambiguous = applyModelEdit("a\nb\na\n", "<<<<<<< SEARCH\na\n=======\nc\n>>>>>>> REPLACE");
    expect(!ambiguous.ok && ambiguous.error).toContain("mehrdeutig");
    const broken = applyModelEdit(original, "<<<<<<< SEARCH\nfrom users\n");
    expect(broken.ok).toBe(false);
  });

  test("treats output without blocks as full replacement", () => {
    expect(applyModelEdit(original, "Sure!\n```sql\nselect 1;\n```\nDone.")).toEqual({
      ok: true,
      mode: "full",
      text: "select 1;\n",
    });
    expect(applyModelEdit("x", "select 2;")).toEqual({ ok: true, mode: "full", text: "select 2;" });
    expect(applyModelEdit("x", "```\n```").ok).toBe(false);
    expect(stripFences("```sql\nselect 1;\n")).toBe("select 1;");
    expect(stripFences("no fences ")).toBe("no fences");
  });
});

describe("diffLines and applyHunks", () => {
  test("uses 1-based positions and groups adjacent changes", () => {
    expect(diffLines("a\nb\nc\nd", "a\nB\nC\nd")).toEqual([
      { oldStart: 2, oldLines: ["b", "c"], newStart: 2, newLines: ["B", "C"] },
    ]);
    expect(diffLines("a\nb", "a\nx\nb")).toEqual([
      { oldStart: 2, oldLines: [], newStart: 2, newLines: ["x"] },
    ]);
    expect(diffLines("a\nb\nc", "a\nc")).toEqual([
      { oldStart: 2, oldLines: ["b"], newStart: 2, newLines: [] },
    ]);
    expect(diffLines("same", "same")).toEqual([]);
  });

  test("falls back to one hunk beyond maxCells", () => {
    const a = Array.from({ length: 100 }, (_, index) => `a${index}`).join("\n");
    const b = Array.from({ length: 100 }, (_, index) =>
      index % 2 ? `a${index}` : `b${index}`,
    ).join("\n");
    const hunks = diffLines(a, b, { maxCells: 100 });
    expect(hunks).toHaveLength(1);
    expect(applyHunks(a, hunks, [true])).toBe(b);
    expect(diffLines(a, b).length).toBe(50);
  });

  test("preserves CRLF and trailing newline", () => {
    const a = "a\r\nb\r\n";
    const b = "a\r\nc\r\nd\r\n";
    const hunks = diffLines(a, b);
    expect(applyHunks(a, hunks, [true])).toBe(b);
    expect(applyHunks("x\n", diffLines("x\n", "x"), [true])).toBe("x");
    expect(applyHunks("x", diffLines("x", "x\n"), [true])).toBe("x\n");
  });

  test("property: all, none and any subset merge consistently", () => {
    const next = random(42);
    for (let round = 0; round < 200; round++) {
      const length = Math.floor(next() * 30);
      const a = Array.from({ length }, () => `l${Math.floor(next() * 8)}`);
      const b: string[] = [];
      for (const line of a) {
        const roll = next();
        if (roll < 0.15) continue;
        if (roll < 0.3) b.push(`n${Math.floor(next() * 5)}`);
        else b.push(line);
        if (next() < 0.1) b.push(`i${Math.floor(next() * 5)}`);
      }
      const textA = a.join("\n") + (round % 2 ? "\n" : "");
      const textB = b.join("\n") + (round % 3 ? "\n" : "");
      const hunks = diffLines(textA, textB);
      expect(
        applyHunks(
          textA,
          hunks,
          hunks.map(() => true),
        ),
      ).toBe(textB);
      expect(
        applyHunks(
          textA,
          hunks,
          hunks.map(() => false),
        ),
      ).toBe(textA);
      const subset = hunks.map(() => next() < 0.5);
      const merged = applyHunks(textA, hunks, subset).split("\n");
      let expectedLength = textA.split("\n").length;
      for (const [index, hunk] of hunks.entries())
        if (subset[index]) expectedLength += hunk.newLines.length - hunk.oldLines.length;
      expect(merged.length).toBe(expectedLength);
      const rejectedFirst = hunks.map((_, index) => index !== 0);
      if (hunks.length > 0) {
        const partial = applyHunks(textA, hunks, rejectedFirst);
        const rest = diffLines(partial, textB);
        expect(
          applyHunks(
            partial,
            rest,
            rest.map(() => true),
          ),
        ).toBe(textB);
      }
    }
  });
});

describe("compactHistory", () => {
  function conversation(count: number, size: number): HistoryMessage[] {
    return Array.from({ length: count }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      text: `${index}:${"x".repeat(size)}`,
    }));
  }

  function alternates(messages: HistoryMessage[]) {
    return messages.every(
      (message, index) => index === 0 || message.role !== messages[index - 1].role,
    );
  }

  test("returns short histories unchanged", () => {
    const messages = conversation(4, 10);
    expect(compactHistory(messages)).toEqual({ messages, compacted: 0 });
  });

  test("shortens older messages and keeps the tail verbatim", () => {
    const messages = conversation(20, 2000);
    const { messages: result, compacted } = compactHistory(messages, { maxChars: 30_000 });
    expect(result.slice(-6)).toEqual(messages.slice(-6));
    expect(result[0].role).toBe("user");
    expect(alternates(result)).toBe(true);
    expect(result.at(-1)).toBe(messages.at(-1) as HistoryMessage);
    expect(compacted).toBe(14);
    expect(result[0].text.length).toBe(600);
    expect(result[1].text).toMatch(/^1:x{398}…x{200}$/);
  });

  test("uses a summary and drops the oldest messages when still too long", () => {
    const messages = conversation(40, 2000);
    const { messages: result } = compactHistory(messages, {
      maxChars: 14_000,
      summary: { count: 10, text: "Wir haben Tabellen besprochen." },
    });
    expect(result[0]).toEqual({
      role: "user",
      text: "Zusammenfassung des bisherigen Gesprächs:\nWir haben Tabellen besprochen.",
    });
    expect(result[1]).toEqual({ role: "assistant", text: "OK." });
    expect(alternates(result)).toBe(true);
    expect(result.slice(-6)).toEqual(messages.slice(-6));
    expect(result.reduce((sum, message) => sum + message.text.length, 0)).toBeLessThanOrEqual(
      14_000,
    );
  });

  test("never splits surrogate pairs and starts with a user message", () => {
    const emoji = "😀".repeat(1000);
    const messages: HistoryMessage[] = [
      { role: "assistant", text: emoji },
      { role: "user", text: emoji },
      { role: "assistant", text: emoji },
      { role: "user", text: "last" },
    ];
    const { messages: result } = compactHistory(messages, { maxChars: 3000, keepLast: 1 });
    expect(result[0].role).toBe("user");
    expect(result.at(-1)?.text).toBe("last");
    for (const message of result) {
      expect(() => encodeURIComponent(message.text)).not.toThrow();
    }
  });

  test("historyNeedsSummary reports leading messages to summarise", () => {
    const messages = conversation(20, 2000);
    expect(historyNeedsSummary(conversation(4, 10))).toEqual({ needed: false, count: 0 });
    expect(historyNeedsSummary(messages, { maxChars: 10_000 })).toEqual({
      needed: true,
      count: 14,
    });
    expect(
      historyNeedsSummary(messages, { maxChars: 10_000, summary: { count: 14, text: "s" } }),
    ).toEqual({ needed: false, count: 14 });
  });
});
