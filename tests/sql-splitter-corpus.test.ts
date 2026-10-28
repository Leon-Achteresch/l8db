import { describe, expect, test } from "bun:test";

import { splitSqlStatements } from "../src/lib/sql-statements";
import corpus from "./fixtures/sql-splitter-corpus.json";

function normalize(text: string): string {
  let rest = text.trimStart();
  for (;;) {
    if (rest.startsWith("--")) {
      const newline = rest.indexOf("\n");
      rest = newline < 0 ? "" : rest.slice(newline + 1).trimStart();
    } else if (rest.startsWith("/*")) {
      const close = rest.indexOf("*/");
      rest = close < 0 ? "" : rest.slice(close + 2).trimStart();
    } else break;
  }
  rest = rest.trimEnd();
  return (rest.endsWith(";") ? rest.slice(0, -1) : rest).trimEnd();
}

describe("shared splitter corpus", () => {
  for (const item of corpus.cases) {
    test(`${item.dialect}: ${item.name}`, () => {
      const result = splitSqlStatements(item.sql, item.dialect);
      expect(result.unterminated).toBe(false);
      expect(result.statements.map((statement) => normalize(statement.text))).toEqual(
        item.statements.map(normalize),
      );
      expect(result.commands.map((command) => command.text)).toEqual(
        "commands" in item ? item.commands : [],
      );
      for (const part of [...result.statements, ...result.commands])
        expect(item.sql.slice(part.start, part.end)).toBe(part.text);
    });
  }
});
