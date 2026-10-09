import { expect, test } from "bun:test";
import {
  callAt,
  parseRoutineSignatures,
  signatureHelp,
  signaturesFromArgs,
} from "@/lib/sql-intellisense/signature";

const SPEC = `CREATE OR REPLACE PACKAGE PA_VERLADUNG AS
  -- PROCEDURE OLD_ORDER(p NUMBER);
  FUNCTION MOVE_ORDER(
    p_from   IN  NUMBER,
    p_to     IN  NUMBER,
    p_order  IN  NUMBER DEFAULT NVL(NULL, 0),
    o_code   OUT INTEGER,
    o_text   OUT VARCHAR2
  ) RETURN INTEGER;
  PROCEDURE MOVE_ORDER(p_order IN NUMBER);
  PROCEDURE RESET;
END PA_VERLADUNG;`;

test("finds the innermost open call and the active argument", () => {
  expect(callAt("res := PA_VERLADUNG.MOVE_ORDER(1884, 1890, ")).toEqual({
    path: ["PA_VERLADUNG", "MOVE_ORDER"],
    activeArg: 2,
    namedArg: null,
  });
  expect(callAt("x := APP.PKG.F(NVL(a, 1), SUBSTR('a,(b', 1")?.path).toEqual(["SUBSTR"]);
  expect(callAt("x := APP.PKG.F(NVL(a, 1), SUBSTR('a,(b', 1), ")).toEqual({
    path: ["APP", "PKG", "F"],
    activeArg: 2,
    namedArg: null,
  });
  expect(callAt("F(a, -- b, c\n ")?.activeArg).toBe(1);
  expect(callAt("F(a /* , ( */, ")?.activeArg).toBe(1);
  expect(callAt('"App"."Fn"(1, ')?.path).toEqual(["App", "Fn"]);
  expect(callAt("F(1); G")).toBeNull();
  expect(callAt("SELECT 'F(")).toBeNull();
  expect(callAt("PA.MOVE_ORDER(o_text => x, p_to => ")?.namedArg).toBe("p_to");
});

test("parses package spec signatures with overloads, defaults and comments", () => {
  expect(parseRoutineSignatures(SPEC)).toEqual([
    {
      kind: "FUNCTION",
      name: "MOVE_ORDER",
      params: [
        "p_from IN NUMBER",
        "p_to IN NUMBER",
        "p_order IN NUMBER DEFAULT NVL(NULL, 0)",
        "o_code OUT INTEGER",
        "o_text OUT VARCHAR2",
      ],
      returns: "INTEGER",
    },
    { kind: "PROCEDURE", name: "MOVE_ORDER", params: ["p_order IN NUMBER"], returns: null },
    { kind: "PROCEDURE", name: "RESET", params: [], returns: null },
  ]);
  expect(
    parseRoutineSignatures(
      "CREATE OR REPLACE FUNCTION public.add_tax(amount numeric, rate numeric DEFAULT 0.19)\n RETURNS numeric LANGUAGE sql AS $$ SELECT 1 $$",
    ),
  ).toEqual([
    {
      kind: "FUNCTION",
      name: "add_tax",
      params: ["amount numeric", "rate numeric DEFAULT 0.19"],
      returns: "numeric",
    },
  ]);
});

test("highlights the active parameter by position or by name", () => {
  const sigs = parseRoutineSignatures(SPEC).filter((sig) => sig.name === "MOVE_ORDER");
  const byPosition = signatureHelp(
    sigs,
    { path: ["PA_VERLADUNG", "MOVE_ORDER"], activeArg: 3, namedArg: null },
    "PA_VERLADUNG.MOVE_ORDER",
  );
  expect(byPosition?.activeSignature).toBe(0);
  expect(byPosition?.activeParameter).toBe(3);
  const first = byPosition?.signatures[0];
  if (!first) throw new Error("signature missing");
  const [start, end] = first.parameters[3].label;
  expect(first.label.slice(start, end)).toBe("o_code OUT INTEGER");
  expect(first.label.endsWith(") RETURN INTEGER")).toBe(true);

  const named = signatureHelp(
    sigs,
    { path: ["MOVE_ORDER"], activeArg: 0, namedArg: "O_TEXT" },
    "MOVE_ORDER",
  );
  expect(named?.activeParameter).toBe(4);

  const overload = signatureHelp(
    [sigs[1], sigs[0]],
    { path: ["MOVE_ORDER"], activeArg: 2, namedArg: null },
    "MOVE_ORDER",
  );
  expect(overload?.activeSignature).toBe(1);
  expect(signatureHelp([], { path: ["X"], activeArg: 0, namedArg: null }, "X")).toBeNull();
});

test("PostgreSQL identity args become parameters", () => {
  expect(signaturesFromArgs("f", "p_id integer, p_tags text[]", "void").params).toEqual([
    "p_id integer",
    "p_tags text[]",
  ]);
});

test("signature help stays fast on large scripts", () => {
  const script = `${"UPDATE t SET a = NVL(b, 'x;y') WHERE id = 1; -- note (\n".repeat(400)}BEGIN res := PA_VERLADUNG.MOVE_ORDER(1884, 1890, SUBSTR('a', 1), `;
  const spec = `CREATE PACKAGE P AS\n${Array.from({ length: 400 }, (_, i) => `  FUNCTION F${i}(a IN NUMBER, b IN VARCHAR2 DEFAULT 'x', c OUT DATE) RETURN NUMBER;`).join("\n")}\nEND;`;
  const durations: number[] = [];
  for (let run = 0; run < 21; run++) {
    const started = performance.now();
    const call = callAt(script);
    const sigs = parseRoutineSignatures(spec).filter((sig) => sig.name === "F399");
    signatureHelp(sigs, call ?? { path: [], activeArg: 0, namedArg: null }, "P.F399");
    durations.push(performance.now() - started);
    expect(call?.activeArg).toBe(3);
  }
  durations.sort((a, b) => a - b);
  console.log(
    `signature help 20k chars + 400 member spec: median ${durations[10].toFixed(2)} ms, p95 ${durations[19].toFixed(2)} ms`,
  );
  expect(durations[10]).toBeLessThan(8);
  expect(durations[19]).toBeLessThan(16);
});
