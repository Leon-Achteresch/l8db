import { describe, expect, test } from "bun:test";

import {
  askMissingVariables,
  createSubstitutionState,
  parseSqlPlusCommand,
  substitute,
  substitutionSession,
} from "../src/lib/sql-statements/sqlplus";
import fixture from "./fixtures/sqlplus-substitution.json";

describe("shared substitution fixture", () => {
  for (const item of fixture.cases) {
    test(item.name, () => {
      const state = {
        defines: { ...item.defines } as Record<string, string>,
        marker: "marker" in item ? item.marker : "&",
        escape: "escape" in item ? item.escape : null,
      };
      const result = substitute(item.sql, state);
      if ("missing" in item) expect(result.missing).toEqual(item.missing);
      else {
        expect(result.missing).toEqual([]);
        expect(result.text).toBe(item.expected);
      }
    });
  }
});

test("SQL*Plus settings parse like SQL*Plus", () => {
  expect(parseSqlPlusCommand("DEFINE tab = 'emp x'")).toEqual({
    type: "define",
    name: "TAB",
    value: "emp x",
  });
  expect(parseSqlPlusCommand("def n=5")).toEqual({ type: "define", name: "N", value: "5" });
  expect(parseSqlPlusCommand("DEFINE")).toEqual({ type: "other" });
  expect(parseSqlPlusCommand("UNDEF a b")).toEqual({ type: "undefine", names: ["A", "B"] });
  expect(parseSqlPlusCommand("SET DEFINE OFF")).toEqual({ type: "set-define", marker: null });
  expect(parseSqlPlusCommand("set def '^'")).toEqual({ type: "set-define", marker: "^" });
  expect(parseSqlPlusCommand("SET ESCAPE ON")).toEqual({ type: "set-escape", escape: "\\" });
  expect(parseSqlPlusCommand("REM x")).toEqual({ type: "remark" });
});

test("&& answers become session defines, & answers are asked again with the last value", async () => {
  const session = substitutionSession("tab-substitution-test");
  const asked: { names: string[]; defaults: Record<string, string> }[] = [];
  const ask = async (names: string[], defaults: Record<string, string>) => {
    asked.push({ names, defaults: { ...defaults } });
    return Object.fromEntries(names.map((name) => [name, name.toLowerCase()]));
  };
  const parts = [
    { kind: "command", text: "DEFINE known = 1" },
    { kind: "sql", text: "SELECT &known, &&perm, &once, &perm FROM dual" },
  ];
  const answers = await askMissingVariables(parts, session, ask);
  expect(asked[0].names).toEqual(["PERM", "ONCE"]);
  expect(
    substitute(parts[1].text, { ...session.state, defines: { KNOWN: "1" } }, answers ?? {}),
  ).toEqual({ text: "SELECT 1, perm, once, perm FROM dual", missing: [] });
  substitute(parts[1].text, session.state, answers ?? {});
  await askMissingVariables(parts, session, ask);
  expect(asked[1]).toEqual({ names: ["ONCE"], defaults: { PERM: "perm", ONCE: "once" } });
  expect(createSubstitutionState()).toEqual({ defines: {}, marker: "&", escape: null });
  await expect(askMissingVariables(parts, substitutionSession("other"), undefined)).rejects.toThrow(
    "&PERM",
  );
});
