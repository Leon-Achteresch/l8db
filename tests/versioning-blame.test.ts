import { beforeEach, expect, mock, test } from "bun:test";

const calls: string[] = [];
let project: Record<string, unknown> = {};
const blames: Record<string, string | null> = {};
let failBlame = false;

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: { request: Record<string, string> }) => {
    if (command !== "versioning_repository") throw new Error(`Unerwartet: ${command}`);
    const { action, path } = args.request;
    calls.push(`${action}:${path}`);
    if (action === "read") return JSON.stringify(project);
    if (action === "blame") {
      if (failBlame) throw new Error("git fehlt");
      return blames[path] ?? null;
    }
    throw new Error(`Unerwartete Aktion ${action}`);
  },
}));

const {
  blameHover,
  blameLabel,
  clearBlameCache,
  loadBlame,
  mapLines,
  PACKAGE_TYPES,
  parseBlame,
  ROUTINE_TYPES,
  relativeTime,
  UNCOMMITTED,
} = await import("../src/lib/versioning/blame");

const A = "a".repeat(40);
const B = "b".repeat(40);
const PORCELAIN = [
  `${A} 1 1 2`,
  "author Ada Lovelace",
  "author-mail <ada@example.invalid>",
  "author-time 1700000000",
  "author-tz +0100",
  "committer Ada Lovelace",
  "summary feat: *erste* Fassung",
  "filename database/objects/f.sql",
  "\tSELECT 1",
  `${A} 2 2`,
  "\tFROM dual",
  `${UNCOMMITTED} 3 3 1`,
  "author Not Committed Yet",
  "author-mail <not.committed.yet>",
  "author-time 1700000100",
  "summary Version of database/objects/f.sql from database/objects/f.sql",
  "filename database/objects/f.sql",
  "\tWHERE 1 = 1",
  `${B} 1 4 1`,
  "author Grace Hopper",
  "author-mail <grace@example.invalid>",
  "author-time 1690000000",
  "summary fix: Filter",
  "previous 1111111111111111111111111111111111111111 database/objects/f.sql",
  "filename database/objects/f.sql",
  "\t",
  "",
].join("\n");

beforeEach(() => {
  calls.length = 0;
  failBlame = false;
  clearBlameCache();
  project = {
    format: 1,
    id: "p",
    name: "P",
    kind: "oracle",
    objects: [
      {
        id: "f",
        path: "database/objects/f.sql",
        selection: { schema: "APP", objectType: "routine", objectName: "F", objectOid: null },
      },
      {
        id: "pkg",
        path: "database/objects/pkg.pks",
        bodyPath: "database/objects/pkg.pkb",
        selection: { schema: "APP", objectType: "package", objectName: "PKG", objectOid: null },
      },
    ],
  };
  blames["database/objects/f.sql"] = PORCELAIN;
  blames["database/objects/pkg.pkb"] = PORCELAIN;
});

test("parses porcelain output with repeated commits, uncommitted and empty lines", () => {
  const { text, lines } = parseBlame(PORCELAIN);
  expect(text).toBe("SELECT 1\nFROM dual\nWHERE 1 = 1\n");
  expect(lines.map((line) => line.hash)).toEqual([A, A, UNCOMMITTED, B]);
  expect(lines[0]).toBe(lines[1]);
  expect(lines[1]).toEqual({
    hash: A,
    author: "Ada Lovelace",
    mail: "ada@example.invalid",
    time: 1_700_000_000_000,
    summary: "feat: *erste* Fassung",
  });
  expect(parseBlame("")).toEqual({ text: "", lines: [] });
});

test("maps editor lines onto repository lines across edits, CRLF and trailing whitespace", () => {
  const file = "a\nb\nc\nd\n";
  expect(mapLines(file, "a\r\nb  \r\nc\r\nd")).toEqual([0, 1, 2, 3]);
  expect(mapLines(file, "a\nneu\nb\nc\nd")).toEqual([0, null, 1, 2, 3]);
  expect(mapLines(file, "a\nc\nd")).toEqual([0, 2, 3]);
  expect(mapLines(file, "a\nB\nc\nd\n\n")).toEqual([0, null, 2, 3, null, null]);
  expect(mapLines("", "x\ny")).toEqual([null, null]);
  const repeated = "BEGIN\n  a;\nEND;\nBEGIN\n  b;\nEND;";
  expect(mapLines(repeated, "BEGIN\n  a;\nEND;\nBEGIN\n  neu;\n  b;\nEND;")).toEqual([
    0,
    1,
    2,
    3,
    null,
    4,
    5,
  ]);
  expect(mapLines("x\ny\nz", "z\ny\nx")).toEqual([null, null, 0]);
});

test("formats labels and hovers like VS Code with escaped markdown", () => {
  const now = Date.UTC(2026, 10, 18, 12);
  const { lines } = parseBlame(PORCELAIN);
  expect(relativeTime(now - 30_000, now)).toBe("gerade eben");
  expect(relativeTime(now - 2 * 3_600_000, now)).toBe("vor 2 Stunden");
  expect(relativeTime(now - 400 * 86_400_000, now)).toBe("letztes Jahr");
  expect(blameLabel(null, now)).toBe("Weicht vom Repository ab");
  expect(blameLabel(lines[2], now)).toBe("Noch nicht committet");
  expect(blameLabel({ ...lines[0], time: now - 3 * 86_400_000 }, now)).toBe(
    "feat: *erste* Fassung, Ada Lovelace (vor 3 Tagen)",
  );
  const hover = blameHover(lines[0], "database/objects/f.sql", now);
  expect(hover).toContain("**Ada Lovelace** \\<ada@example\\.invalid\\>");
  expect(hover).toContain("feat: \\*erste\\* Fassung");
  expect(hover).toContain("`aaaaaaaa`");
  expect(blameHover(lines[2], "x.sql", now)).toContain("noch nicht committet");
  expect(blameHover(null, "x.sql", now)).toContain("`x.sql`");
});

test("finds the managed object file, including package bodies, and caches requests", async () => {
  const routine = { kind: "oracle", schema: "APP", name: "F", types: ROUTINE_TYPES };
  const first = await loadBlame(routine, "/repo");
  expect(first?.path).toBe("database/objects/f.sql");
  expect(first?.lines).toHaveLength(4);
  await loadBlame(routine, "/repo");
  await loadBlame(routine, "/repo");
  expect(calls).toEqual(["read:database/project.json", "blame:database/objects/f.sql"]);

  const body = await loadBlame(
    { kind: "oracle", schema: "APP", name: "PKG", types: PACKAGE_TYPES, part: "body" },
    "/repo",
  );
  expect(body?.path).toBe("database/objects/pkg.pkb");
  expect(
    await loadBlame(
      { kind: "oracle", schema: "APP", name: "PKG", types: PACKAGE_TYPES, part: "spec" },
      "/repo",
    ),
  ).toBeNull();
  expect(calls).toHaveLength(4);
});

test("stays silent without repository, for other databases or unmanaged objects", async () => {
  const routine = { kind: "oracle", schema: "APP", name: "F", types: ROUTINE_TYPES };
  expect(await loadBlame(routine, "")).toBeNull();
  expect(calls).toHaveLength(0);
  expect(await loadBlame({ ...routine, kind: "postgres" }, "/repo")).toBeNull();
  expect(await loadBlame({ ...routine, name: "G" }, "/repo")).toBeNull();
  expect(await loadBlame({ ...routine, schema: "app" }, "/repo")).toBeNull();
  expect(await loadBlame({ ...routine, types: PACKAGE_TYPES }, "/repo")).toBeNull();
  expect(calls).toEqual(["read:database/project.json"]);
});

test("retries after a failed git call instead of caching the error", async () => {
  const routine = { kind: "oracle", schema: "APP", name: "F", types: ROUTINE_TYPES };
  failBlame = true;
  await expect(loadBlame(routine, "/repo")).rejects.toThrow("git fehlt");
  failBlame = false;
  expect((await loadBlame(routine, "/repo"))?.lines).toHaveLength(4);
  expect(calls.filter((call) => call.startsWith("blame"))).toHaveLength(2);
});
