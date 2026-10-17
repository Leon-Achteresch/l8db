import { describe, expect, test } from "bun:test";
import { filterAiChanges, filterAiHasChanges } from "@/lib/filter-ai/changes";
import { filterAiExamples } from "@/lib/filter-ai/examples";
import {
  extractFilterAiJson,
  filterSqlProblem,
  parseFilterAiResponse,
  resolveFilterColumn,
} from "@/lib/filter-ai/parse";
import { filterAiRequest } from "@/lib/filter-ai/prompt";
import type { FilterAiContext } from "@/lib/filter-ai/types";
import { compileFilterConditions } from "@/lib/sql-filter";
import type { FilterCondition, RowRule } from "@/lib/table-view-state";

const columns = ["id", "message_id", "status", "tokens", "created_at", "Order Total", "note"];
const columnDetails = [
  { name: "id", data_type: "int4" },
  { name: "message_id", data_type: "text" },
  { name: "status", data_type: "varchar" },
  { name: "tokens", data_type: "int4" },
  { name: "created_at", data_type: "timestamptz" },
  { name: "Order Total", data_type: "numeric" },
  { name: "note", data_type: "text" },
];

function context(patch: Partial<FilterAiContext> = {}): FilterAiContext {
  return {
    kind: "postgres",
    json: false,
    mode: "simple",
    columns,
    columnDetails,
    conditions: [],
    combinator: "AND",
    sql: "",
    rules: [],
    today: "2026-10-17",
    ...patch,
  };
}

const cond = (column: string, operator: string, value = ""): FilterCondition => ({
  id: `${column}-${operator}-${value}`,
  column,
  operator,
  value,
});

const strip = (conditions: FilterCondition[] | null) =>
  conditions?.map(({ column, operator, value }) => ({ column, operator, value })) ?? null;

describe("extractFilterAiJson", () => {
  test("reads fenced, prefixed and trailing JSON", () => {
    expect(extractFilterAiJson('```json\n{"filters":[]}\n```')).toEqual({ filters: [] });
    expect(extractFilterAiJson('Klar! Hier: {"note":"ok"} Viel Spaß')).toEqual({ note: "ok" });
    expect(extractFilterAiJson('{"a":"}{"}')).toEqual({ a: "}{" });
  });

  test("repairs smart quotes and trailing commas", () => {
    expect(extractFilterAiJson("{“filters”: [ {“column”: “status”}, ], }")).toEqual({
      filters: [{ column: "status" }],
    });
  });

  test("skips invalid candidates and gives up on truncated or missing JSON", () => {
    expect(extractFilterAiJson('{not json} then {"note":"x"}')).toEqual({ note: "x" });
    expect(extractFilterAiJson('{"filters": [{"column": "status"')).toBeUndefined();
    expect(extractFilterAiJson("Ich kann das nicht.")).toBeUndefined();
    expect(extractFilterAiJson("")).toBeUndefined();
  });
});

describe("resolveFilterColumn", () => {
  test("matches exact, quoted, prefixed and case-insensitive names", () => {
    expect(resolveFilterColumn("status", columns)).toBe("status");
    expect(resolveFilterColumn('"Order Total"', columns)).toBe("Order Total");
    expect(resolveFilterColumn("`created_at`", columns)).toBe("created_at");
    expect(resolveFilterColumn("t.tokens", columns)).toBe("tokens");
    expect(resolveFilterColumn("STATUS", columns)).toBe("status");
    expect(resolveFilterColumn("order total", columns)).toBe("Order Total");
  });

  test("rejects unknown, ambiguous and non-string names", () => {
    expect(resolveFilterColumn("missing", columns)).toBeNull();
    expect(resolveFilterColumn("name", ["Name", "NAME"])).toBeNull();
    expect(resolveFilterColumn(42, columns)).toBeNull();
    expect(resolveFilterColumn("  ", columns)).toBeNull();
  });
});

describe("parseFilterAiResponse", () => {
  test("turns a clean answer into conditions and rules", () => {
    const proposal = parseFilterAiResponse(
      JSON.stringify({
        filters: [
          { column: "status", operator: "eq", value: "error" },
          { column: "created_at", operator: "gte", value: "2026-10-10" },
        ],
        combinator: "AND",
        rules: [
          { color: "yellow", conditions: [{ column: "tokens", operator: "gt", value: 4000 }] },
        ],
        note: "Fehler der letzten Woche",
      }),
      context(),
    );
    expect(strip(proposal.conditions)).toEqual([
      { column: "status", operator: "eq", value: "error" },
      { column: "created_at", operator: "gte", value: "2026-10-10" },
    ]);
    expect(proposal.conditions?.[1].dataType).toBe("timestamptz");
    expect(proposal.rules?.[0]).toMatchObject({ color: "#eab308", combinator: "AND" });
    expect(strip(proposal.rules?.[0].conditions ?? null)).toEqual([
      { column: "tokens", operator: "gt", value: "4000" },
    ]);
    expect(proposal.note).toBe("Fehler der letzten Woche");
    expect(proposal.warnings).toEqual([]);
    expect(proposal.sql).toBeNull();
  });

  test("normalizes operator aliases, wildcards, quotes, lists and nulls", () => {
    const proposal = parseFilterAiResponse(
      JSON.stringify({
        filters: [
          { column: "status", operator: "==", value: "'done'" },
          { column: "note", operator: "LIKE", value: "%urgent%" },
          { column: "message_id", operator: "starts_with", value: "msg_*" },
          { column: "status", operator: "not in", value: "a, b,  ,a" },
          { column: "note", operator: "=", value: null },
          { column: "tokens", operator: "!=", value: null },
          { column: "status", operator: "=", value: ["x", "y"] },
          { column: "tokens", operator: "between", value: [10, 20] },
          { column: "id", operator: "is not null" },
        ],
      }),
      context(),
    );
    expect(strip(proposal.conditions)).toEqual([
      { column: "status", operator: "eq", value: "done" },
      { column: "note", operator: "contains", value: "urgent" },
      { column: "message_id", operator: "startsWith", value: "msg_" },
      { column: "status", operator: "notIn", value: '["a","b"]' },
      { column: "note", operator: "isNull", value: "" },
      { column: "tokens", operator: "isNotNull", value: "" },
      { column: "status", operator: "in", value: '["x","y"]' },
      { column: "tokens", operator: "gte", value: "10" },
      { column: "tokens", operator: "lte", value: "20" },
      { column: "id", operator: "isNotNull", value: "" },
    ]);
  });

  test("accepts mapping objects, bare arrays and alternative keys", () => {
    expect(
      strip(
        parseFilterAiResponse('{"filters": {"status": "error", "note": null}}', context())
          .conditions,
      ),
    ).toEqual([
      { column: "status", operator: "eq", value: "error" },
      { column: "note", operator: "isNull", value: "" },
    ]);
    expect(
      strip(
        parseFilterAiResponse('[{"field":"tokens","op":">","value":"5"}]', context()).conditions,
      ),
    ).toEqual([{ column: "tokens", operator: "gt", value: "5" }]);
  });

  test("drops invalid conditions with readable warnings but keeps the valid ones", () => {
    const proposal = parseFilterAiResponse(
      JSON.stringify({
        filters: [
          { column: "nope", operator: "eq", value: "x" },
          { column: "status", operator: "frobnicate", value: "x" },
          { column: "status", operator: "eq", value: "   " },
          { column: "status", operator: "eq", value: { deep: true } },
          { column: "status", operator: "in", value: [] },
          { column: "note", operator: "eq", value: "x".repeat(5000) },
          "garbage",
          null,
          { column: "tokens", operator: "gt", value: 1 },
          { column: "tokens", operator: "gt", value: 1 },
        ],
      }),
      context(),
    );
    expect(strip(proposal.conditions)).toEqual([{ column: "tokens", operator: "gt", value: "1" }]);
    expect(proposal.warnings).toContain("Spalte „nope“ gibt es nicht – Bedingung übersprungen.");
    expect(proposal.warnings).toContain(
      "Unbekannter Operator bei „status“ – Bedingung übersprungen.",
    );
    expect(proposal.warnings.length).toBeLessThanOrEqual(8);
  });

  test("never clears filters when every proposed condition is invalid", () => {
    expect(() =>
      parseFilterAiResponse('{"filters":[{"column":"nope","value":"x"}]}', context()),
    ).toThrow("Spalte „nope“ gibt es nicht");
    const withRule = parseFilterAiResponse(
      '{"filters":[{"column":"nope","value":"x"}],"rules":[{"color":"red","conditions":[{"column":"status","value":"x"}]}]}',
      context(),
    );
    expect(withRule.conditions).toBeNull();
    expect(withRule.rules).toHaveLength(1);
  });

  test("an empty filter list clears the filters on purpose", () => {
    const proposal = parseFilterAiResponse('{"filters": []}', context());
    expect(proposal.conditions).toEqual([]);
  });

  test("caps conditions, rules and list values", () => {
    const filters = Array.from({ length: 80 }, (_, index) => ({
      column: "tokens",
      operator: "gt",
      value: index,
    }));
    const rules = Array.from({ length: 40 }, (_, index) => ({
      color: "blue",
      conditions: [{ column: "tokens", operator: "eq", value: index }],
    }));
    const list = Array.from({ length: 900 }, (_, index) => `v${index}`);
    const proposal = parseFilterAiResponse(
      JSON.stringify({
        filters: [...filters, { column: "status", operator: "in", value: list }],
        rules,
      }),
      context(),
    );
    expect(proposal.conditions).toHaveLength(25);
    expect(proposal.rules).toHaveLength(12);
    const capped = parseFilterAiResponse(
      JSON.stringify({ filters: [{ column: "status", operator: "in", value: list }] }),
      context(),
    );
    expect(JSON.parse(capped.conditions?.[0].value ?? "[]")).toHaveLength(200);
  });

  test("maps colour names and hex values and falls back to free palette colours", () => {
    const proposal = parseFilterAiResponse(
      JSON.stringify({
        rules: [
          { color: "Rot", conditions: [{ column: "status", value: "a" }] },
          { color: "#ABC", conditions: [{ column: "status", value: "b" }] },
          { color: "#12345g", conditions: [{ column: "status", value: "c" }] },
          { color: "Lila", column: "status", value: "d" },
          { conditions: [{ column: "status", value: "e" }] },
        ],
      }),
      context({ rules: [{ id: "x", color: "#ef4444", combinator: "AND", conditions: [] }] }),
    );
    expect(proposal.rules?.map((rule) => rule.color)).toEqual([
      "#ef4444",
      "#aabbcc",
      "#f97316",
      "#8b5cf6",
      "#eab308",
    ]);
  });

  test("forces AND and drops unsupported operators for Cassandra", () => {
    const proposal = parseFilterAiResponse(
      JSON.stringify({
        combinator: "OR",
        filters: [
          { column: "status", operator: "contains", value: "x" },
          { column: "tokens", operator: "gt", value: 1 },
          { column: "tokens", operator: "lt", value: 9 },
        ],
      }),
      context({ kind: "cassandra" }),
    );
    expect(proposal.combinator).toBe("AND");
    expect(strip(proposal.conditions)).toEqual([
      { column: "tokens", operator: "gt", value: "1" },
      { column: "tokens", operator: "lt", value: "9" },
    ]);
    expect(proposal.warnings.join(" ")).toContain("nicht unterstützt");
  });

  test("returns a note-only proposal when the request cannot be expressed", () => {
    const proposal = parseFilterAiResponse(
      '{"note":"Die Tabelle hat keine Spalte für Kunden."}',
      context(),
    );
    expect(proposal).toMatchObject({
      conditions: null,
      rules: null,
      sql: null,
      note: "Die Tabelle hat keine Spalte für Kunden.",
    });
  });

  test("explains prose, empty and pointless answers", () => {
    expect(() => parseFilterAiResponse("Sorry, das geht nicht.", context())).toThrow(
      "Die KI hat keinen Filter geliefert: „Sorry, das geht nicht.“",
    );
    expect(() => parseFilterAiResponse("   ", context())).toThrow("keine Antwort");
    expect(() => parseFilterAiResponse("{}", context())).toThrow("keine Änderung");
    expect(() => parseFilterAiResponse("42", context())).toThrow("keinen Filter geliefert");
    expect(() => parseFilterAiResponse(`{"note":"${"x".repeat(250_000)}"}`, context())).toThrow(
      "zu lang",
    );
    expect(() => parseFilterAiResponse("[1, 2]", context())).toThrow("keine Änderung");
  });

  test("simple mode parses SQL answers back into conditions", () => {
    const proposal = parseFilterAiResponse(
      `{"sql": "WHERE status = 'error' AND tokens > 4000;"}`,
      context(),
    );
    expect(strip(proposal.conditions)).toEqual([
      { column: "status", operator: "eq", value: "error" },
      { column: "tokens", operator: "gt", value: "4000" },
    ]);
    expect(proposal.sql).toBeNull();
  });

  test("simple mode falls back to SQL for expressions the builder cannot show", () => {
    const proposal = parseFilterAiResponse(
      `{"sql": "created_at >= now() - interval '7 days'"}`,
      context(),
    );
    expect(proposal.conditions).toBeNull();
    expect(proposal.sql).toBe("created_at >= now() - interval '7 days'");
    expect(proposal.warnings[0]).toContain("als SQL übernommen");
  });

  test("SQL mode keeps SQL and compiles structured answers", () => {
    expect(
      parseFilterAiResponse(`{"sql":"status = 'a' OR tokens > 3"}`, context({ mode: "sql" })).sql,
    ).toBe("status = 'a' OR tokens > 3");
    const compiled = parseFilterAiResponse(
      '{"filters":[{"column":"tokens","operator":"gt","value":3}]}',
      context({ mode: "sql" }),
    );
    expect(compiled.conditions).toBeNull();
    expect(compiled.sql).toBe(
      compileFilterConditions([cond("tokens", "gt", "3")], "AND", "postgres", columnDetails),
    );
  });

  test("rejects dangerous SQL from the model", () => {
    for (const sql of [
      "status = 'a'; DROP TABLE users",
      "status = 'a' -- comment",
      "status = 'a' /* x */",
      "id IN (SELECT id FROM t UNION SELECT 1)",
      "id = 1 RETURNING *",
      "status = 'unterminated",
      "pg_sleep(10) IS NULL",
      "id = 1 # mysql",
      "x = $$a$$",
      "note = 'it\\'s'; delete from t",
    ]) {
      expect(() =>
        parseFilterAiResponse(JSON.stringify({ sql }), context({ mode: "sql" })),
      ).toThrow("ungültigen Ausdruck");
    }
  });

  test("allows the same words inside string literals", () => {
    expect(filterSqlProblem("note = 'drop; -- union /* into'", false)).toBeNull();
    expect(filterSqlProblem('"update" = 1', false)).toBeNull();
    expect(filterSqlProblem("last_update > '2026-01-01'", false)).toBeNull();
  });

  test("MongoDB SQL mode accepts JSON objects only", () => {
    const mongo = context({ kind: "mongodb", json: true, mode: "sql" });
    expect(parseFilterAiResponse('{"sql":"{\\"status\\":\\"error\\"}"}', mongo).sql).toBe(
      '{"status":"error"}',
    );
    expect(() => parseFilterAiResponse('{"sql":"status = 1"}', mongo)).toThrow(
      "kein gültiges JSON",
    );
    expect(() => parseFilterAiResponse('{"sql":"[1,2]"}', mongo)).toThrow("kein JSON-Objekt");
  });

  test("never throws anything but readable errors for random garbage", () => {
    const samples = [
      "{",
      "}",
      "[[[[",
      '{"filters": "status = 1"}',
      '{"filters": 5}',
      '{"rules": "rot"}',
      '{"rules": [1, 2, 3]}',
      '{"filters": [{"column": {"x": 1}}]}',
      '{"sql": 12}',
      '{"combinator": "XOR", "filters": [{"column":"id","value":1}]}',
      "\u0000\u0001\u0002",
      "🙂".repeat(1000),
      `{"note": "${"ä".repeat(5000)}"}`,
    ];
    for (const sample of samples) {
      try {
        const proposal = parseFilterAiResponse(sample, context());
        expect(proposal.note.length).toBeLessThanOrEqual(301);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message.length).toBeGreaterThan(5);
      }
    }
  });
});

describe("filterAiRequest", () => {
  test("describes columns, current state and today's date", () => {
    const request = filterAiRequest(
      context({
        conditions: [cond("status", "in", '["a","b"]'), cond("", "eq", "")],
        rules: [
          { id: "r", color: "#ef4444", combinator: "AND", conditions: [cond("tokens", "gt", "5")] },
        ],
      }),
      "  nur Fehler  ",
    );
    expect(request.cached).toContain("- created_at (timestamptz)");
    expect(request.cached).toContain("- Order Total (numeric)");
    expect(request.system).toContain("eq, neq, in, notIn");
    expect(request.messages[0].text).toContain("Today: 2026-10-17");
    expect(request.messages[0].text).toContain('"value":["a","b"]');
    expect(request.messages[0].text).toContain('"color":"red"');
    expect(request.messages[0].text).toContain("Request: nur Fehler");
    expect(request.messages[0].text).not.toContain('"column":""');
  });

  test("bounds huge schemas, prompts and SQL", () => {
    const many = Array.from({ length: 5000 }, (_, index) => `column_${index}`);
    const request = filterAiRequest(
      context({ columns: many, columnDetails: [], mode: "sql", sql: "x".repeat(50_000) }),
      "y".repeat(50_000),
    );
    expect(request.cached).toContain("(4700 more columns not listed)");
    expect(request.cached.length).toBeLessThan(10_000);
    expect(request.messages[0].text.length).toBeLessThan(7_000);
    expect(request.system).toContain('"sql"');
  });

  test("mentions database limits", () => {
    expect(filterAiRequest(context({ kind: "cassandra" }), "x").system).toContain(
      "does not support OR",
    );
    expect(
      filterAiRequest(context({ kind: "mongodb", json: true, mode: "sql" }), "x").system,
    ).toContain("MongoDB filter document");
  });
});

describe("filterAiChanges", () => {
  const rule = (color: string, value: string): RowRule => ({
    id: value,
    color,
    combinator: "AND",
    conditions: [cond("status", "eq", value)],
  });

  test("lists added, kept and removed filters and rules", () => {
    const current = context({
      conditions: [cond("status", "eq", "a"), cond("tokens", "gt", "1")],
      rules: [rule("#ef4444", "x")],
    });
    const proposal = parseFilterAiResponse(
      JSON.stringify({
        filters: [
          { column: "status", operator: "eq", value: "a" },
          { column: "note", operator: "isNull" },
        ],
        rules: [{ color: "blue", conditions: [{ column: "status", value: "y" }] }],
      }),
      current,
    );
    const changes = filterAiChanges(current, proposal);
    expect(changes.map((change) => [change.kind, change.target])).toEqual([
      ["keep", "filter"],
      ["add", "filter"],
      ["remove", "filter"],
      ["add", "rule"],
      ["remove", "rule"],
    ]);
    expect(filterAiHasChanges(changes)).toBe(true);
  });

  test("detects proposals that change nothing", () => {
    const current = context({ conditions: [cond("status", "in", '["b","a"]')] });
    const proposal = parseFilterAiResponse(
      '{"filters":[{"column":"status","operator":"in","value":["a","b"]}]}',
      current,
    );
    expect(filterAiHasChanges(filterAiChanges(current, proposal))).toBe(false);
  });

  test("shows SQL replacements", () => {
    const current = context({ mode: "sql", sql: "status = 'a'" });
    const changes = filterAiChanges(
      current,
      parseFilterAiResponse(`{"sql":"status = 'b'"}`, current),
    );
    expect(changes).toEqual([
      { kind: "remove", target: "sql", label: "status = 'a'" },
      { kind: "add", target: "sql", label: "status = 'b'" },
    ]);
  });
});

test("filterAiExamples adapts to the columns", () => {
  expect(filterAiExamples(columns, columnDetails)).toEqual([
    "Nur Zeilen der letzten 7 Tage (created_at)",
    "Zeilen ohne message_id rot markieren",
    "Alle Filter entfernen",
  ]);
  expect(filterAiExamples([], [])).toEqual(["Alle Filter entfernen"]);
});
