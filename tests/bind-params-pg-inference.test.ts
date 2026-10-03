import { describe, expect, test } from "bun:test";
import { buildParameterizedQuery } from "../src/lib/bind-params";

describe("buildParameterizedQuery type inference", () => {
  test("leaves text parameters uncast so Postgres infers the column type", () => {
    const result = buildParameterizedQuery("SELECT * FROM users WHERE id = :id LIMIT :n", {
      id: { type: "text", value: "5" },
      n: { type: "text", value: "10" },
    });
    expect(result.sql).toBe("SELECT * FROM users WHERE id = $1 LIMIT $2");
    expect(result.values).toEqual(["5", "10"]);
  });

  test("leaves NULL parameters uncast", () => {
    const result = buildParameterizedQuery("UPDATE t SET n = $1 WHERE id = $2", {
      "1": { type: "null", value: "" },
      "2": { type: "int", value: "3" },
    });
    expect(result.sql).toBe("UPDATE t SET n = $1 WHERE id = $2::bigint");
    expect(result.values).toEqual([null, "3"]);
  });

  test("keeps explicit casts written by the user", () => {
    const result = buildParameterizedQuery("SELECT :name::text IS NULL", {
      name: { type: "text", value: "a" },
    });
    expect(result.sql).toBe("SELECT $1::text IS NULL");
  });

  test("casts explicitly typed parameters", () => {
    const result = buildParameterizedQuery("SELECT $1, $2, $3, $4", {
      "1": { type: "int", value: "1" },
      "2": { type: "numeric", value: "1.5" },
      "3": { type: "bool", value: "yes" },
      "4": { type: "timestamp", value: "2024-01-01" },
    });
    expect(result.sql).toBe("SELECT $1::bigint, $2::numeric, $3::boolean, $4::timestamptz");
  });

  test("never casts Oracle placeholders", () => {
    const result = buildParameterizedQuery(
      "SELECT * FROM t WHERE a = :a AND b = :b",
      { a: { type: "int", value: "1" }, b: { type: "text", value: "x" } },
      "oracle",
    );
    expect(result.sql).toBe("SELECT * FROM t WHERE a = $1 AND b = $2");
  });
});
