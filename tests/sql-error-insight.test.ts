import { expect, test } from "bun:test";
import {
  closestName,
  sqlErrorInsight,
} from "../src/features/query/query-result-table/sql-error-insight";

const sql =
  "select o.id, o.total, cu.email\nfrom orders o join customers cu\non cu.id = o.custmer_id\nwhere o.created_at > now() - interval '7 days';";

test("postgres unknown column gets position, suggestion and fix", () => {
  const error = "ERROR: column o.custmer_id does not exist\nPosition: 74";
  const insight = sqlErrorInsight({
    error,
    kind: "postgres",
    source: { text: sql, base: 0 },
    sql,
    columns: ["id", "total", "customer_id", "email"],
  });
  expect(insight.summary).toBe("Spalte o.custmer_id existiert nicht.");
  expect(insight.suggestion).toBe("customer_id");
  expect(insight.line).toBe(3);
  expect(insight.column).toBe(14);
  expect(insight.fix).toEqual({
    start: sql.indexOf("custmer_id"),
    end: sql.indexOf("custmer_id") + 10,
    text: "customer_id",
  });
});

test("postgres hint wins over fuzzy match and SQLSTATE is read", () => {
  const error =
    'ERROR: column "custmer_id" does not exist\nHinweis: Perhaps you meant to reference the column "o.customer_id".\nSQLSTATE 42703';
  const insight = sqlErrorInsight({ error, kind: "postgres", sql });
  expect(insight.suggestion).toBe("customer_id");
  expect(insight.code).toBe("42703");
});

test("closestName ignores far candidates", () => {
  expect(closestName("custmer_id", ["created_at", "total"])).toBeNull();
  expect(closestName("odrers", ["orders", "customers"])).toBe("orders");
});

test("unrelated errors keep their first line", () => {
  expect(sqlErrorInsight({ error: "ERROR: syntax error at end of input" }).summary).toBe(
    "syntax error at end of input",
  );
});
