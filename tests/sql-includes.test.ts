import { expect, test } from "bun:test";

import { splitSqlStatements } from "../src/lib/sql-statements";
import {
  expandIncludes,
  INCLUDE_LIMITS,
  includeCandidates,
  includeTarget,
  scriptItems,
} from "../src/lib/sql-statements/includes";

function reader(files: Record<string, string>, reads: string[] = []) {
  return async (path: string) => {
    reads.push(path);
    const text = files[path];
    if (text === undefined) throw new Error("ENOENT");
    return text;
  };
}

function plan(sql: string) {
  return scriptItems(splitSqlStatements(sql, "oracle"));
}

test("@, @@ and START are SQL*Plus commands in the Oracle splitter", () => {
  const sql = "@setup\n  @@ sub/next.sql\nSTART 'x'\nstart \"my file.sql\"\nSELECT 1 FROM dual;";
  const split = splitSqlStatements(sql, "oracle");
  expect(split.commands.map((command) => command.text)).toEqual([
    "@setup",
    "@@ sub/next.sql",
    "START 'x'",
    'start "my file.sql"',
  ]);
  expect(split.statements.map((statement) => statement.text)).toEqual(["SELECT 1 FROM dual;"]);
  expect(splitSqlStatements("SELECT 1 FROM dual WHERE a = 1\n@x", "oracle").commands).toEqual([]);
  expect(includeTarget("@@ sub/next.sql")).toEqual({ name: "sub/next.sql", nested: true });
  expect(includeTarget('start "my file.sql"')).toEqual({ name: "my file.sql", nested: false });
  expect(includeTarget("STARTUP")).toBeNull();
  expect(includeCandidates("a", ["/s", null, "/s", "C:\\w"])).toEqual(["/s/a.sql", "C:\\w\\a.sql"]);
  expect(includeCandidates("/abs/b.pls", ["/s"])).toEqual(["/abs/b.pls"]);
});

test("includes resolve beside the script first, then SQLPATH, and @@ beside the caller", async () => {
  const reads: string[] = [];
  const files = {
    "/proj/a.sql": "INSERT INTO t VALUES (1);\n@@lib/b\n",
    "/proj/lib/b.sql": "BEGIN NULL; END;\n/\n",
    "/sqlpath/c.sql": "SELECT 3 FROM dual;",
  };
  const sql = "@a.sql\n@c\nSELECT 9 FROM dual;";
  const items = await expandIncludes(plan(sql), {
    file: "/proj/main.sql",
    searchPath: ["/sqlpath"],
    read: reader(files, reads),
  });
  expect(items.map(({ kind, text, source }) => ({ kind, text, source }))).toEqual([
    { kind: "sql", text: "INSERT INTO t VALUES (1);", source: "/proj/a.sql" },
    { kind: "sql", text: "BEGIN NULL; END;", source: "/proj/lib/b.sql" },
    { kind: "sql", text: "SELECT 3 FROM dual;", source: "/sqlpath/c.sql" },
    { kind: "sql", text: "SELECT 9 FROM dual;", source: undefined },
  ]);
  expect(items.slice(0, 2).every((item) => item.start === 0 && item.end === 6)).toBe(true);
  expect(sql.slice(items[2].start, items[2].end)).toBe("@c");
  expect(reads).toEqual(["/proj/a.sql", "/proj/lib/b.sql", "/proj/c.sql", "/sqlpath/c.sql"]);
});

test("missing files, unsaved tabs, cycles and deep nesting become clear errors", async () => {
  const unsaved = await expandIncludes(plan("@x.sql"), {
    file: null,
    searchPath: [],
    read: reader({}),
  });
  expect(unsaved[0].kind).toBe("error");
  expect(unsaved[0].error).toContain("Datei nicht gefunden: x.sql");
  expect(unsaved[0].error).toContain("gespeicherten Skriptdatei");

  const missing = await expandIncludes(plan("@x"), {
    file: "/p/m.sql",
    searchPath: ["/q"],
    read: reader({}),
  });
  expect(missing[0].error).toBe("Datei nicht gefunden: x (gesucht: /p/x.sql, /q/x.sql)");

  const cycle = await expandIncludes(plan("@a"), {
    file: "/p/m.sql",
    searchPath: [],
    read: reader({
      "/p/m.sql": "@a",
      "/p/a.sql": "@b",
      "/p/b.sql": "SELECT 1 FROM dual;\n@m",
    }),
  });
  expect(cycle.map((item) => item.kind)).toEqual(["sql", "error"]);
  expect(cycle[1].error).toBe("Zyklischer @-Aufruf: /p/m.sql → /p/a.sql → /p/b.sql → /p/m.sql");

  const reads: string[] = [];
  const deep = await expandIncludes(plan("@f0"), {
    file: null,
    searchPath: ["/p"],
    read: async (path) => {
      reads.push(path);
      return `@@f${Number(/f(\d+)\.sql$/.exec(path)?.[1]) + 1}`;
    },
  });
  expect(deep).toHaveLength(1);
  expect(deep[0].error).toContain(`höchstens ${INCLUDE_LIMITS.depth} Ebenen`);
  expect(reads).toHaveLength(INCLUDE_LIMITS.depth);
});
