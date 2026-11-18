import { expect, mock, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";

const LINES = 40_000;
const COMMITS = 500;
const path = "database/objects/pkg_lager.pkb";
const source = Array.from(
  { length: LINES },
  (_, index) => `  PROCEDURE buchen_${index}(p_id IN NUMBER) IS BEGIN NULL; END;`,
);
const seen = new Set<number>();
const porcelain = source
  .map((text, index) => {
    const commit = Math.floor((index * COMMITS) / LINES);
    const hash = (commit + 1).toString(16).padStart(40, "0");
    const header = `${hash} ${index + 1} ${index + 1}`;
    const details = seen.has(commit)
      ? ""
      : `\nauthor Entwickler ${commit % 12}\nauthor-mail <dev${commit % 12}@example.invalid>\nauthor-time ${1_700_000_000 + commit * 3600}\nauthor-tz +0100\nsummary feat: Änderung ${commit}\nfilename ${path}`;
    seen.add(commit);
    return `${header}${details}\n\t${text}`;
  })
  .join("\n");

let requests = 0;
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (_command: string, args: { request: { action: string } }) => {
    requests += 1;
    if (args.request.action === "read")
      return JSON.stringify({
        format: 1,
        id: "p",
        name: "P",
        kind: "oracle",
        objects: [
          {
            id: "pkg",
            path: "database/objects/pkg_lager.pks",
            bodyPath: path,
            selection: { schema: "APP", objectType: "package", objectName: "PKG_LAGER" },
          },
        ],
      });
    return porcelain;
  },
}));
const { clearBlameCache, loadBlame, mapLines, PACKAGE_TYPES, parseBlame } = await import(
  "../src/lib/versioning/blame"
);

test("git blame for a 40,000 line package body stays within budget", async () => {
  const heapBefore = process.memoryUsage().heapUsed;
  const parsed = parseBlame(porcelain);
  const heapAfter = process.memoryUsage().heapUsed;
  expect(parsed.lines).toHaveLength(LINES);
  expect(new Set(parsed.lines).size).toBe(COMMITS);

  const edited = [...source];
  edited.splice(20_000, 1, "  -- geändert");
  edited.splice(30_000, 0, "  -- neu");
  const scattered = source.map((line, index) => (index % 200 === 0 ? `${line} -- x` : line));
  const editor = {
    same: source.join("\r\n"),
    edited: edited.join("\n"),
    scattered: scattered.join("\n"),
  };

  const parse = await measureScenario(() => {
    parseBlame(porcelain);
  });
  const same = await measureScenario(() => {
    mapLines(parsed.text, editor.same);
  });
  const small = await measureScenario(() => {
    mapLines(parsed.text, editor.edited);
  });
  const many = await measureScenario(() => {
    mapLines(parsed.text, editor.scattered);
  });
  const rewritten = source.map((line) => `${line} -- neu`).join("\n");
  const worst = await measureScenario(() => {
    mapLines(parsed.text, rewritten);
  });
  expect(mapLines(parsed.text, rewritten).every((line) => line === null)).toBe(true);
  const map = mapLines(parsed.text, editor.edited);
  expect(map[20_000]).toBeNull();
  expect(map[30_000]).toBeNull();
  expect(map[30_001]).toBe(30_000);
  expect(mapLines(parsed.text, editor.scattered).filter((line) => line === null)).toHaveLength(200);

  clearBlameCache();
  requests = 0;
  const target = {
    kind: "oracle",
    schema: "APP",
    name: "PKG_LAGER",
    types: PACKAGE_TYPES,
    part: "body" as const,
  };
  const loads = await Promise.all(Array.from({ length: 50 }, () => loadBlame(target, "/repo")));
  expect(new Set(loads).size).toBe(1);
  expect(requests).toBe(2);

  await reportScenario("versioning-blame", {
    lines: LINES,
    commits: COMMITS,
    porcelainBytes: porcelain.length,
    parse,
    mapIdentical: same,
    mapSmallEdit: small,
    mapScattered: many,
    mapRewritten: worst,
    parseHeapDeltaBytes: heapAfter - heapBefore,
    requestsFor50Loads: requests,
  });
  expect(parse.medianMs).toBeLessThan(40);
  expect(parse.p95Ms).toBeLessThan(80);
  expect(same.medianMs).toBeLessThan(40);
  expect(small.medianMs).toBeLessThan(40);
  expect(small.p95Ms).toBeLessThan(80);
  expect(many.medianMs).toBeLessThan(60);
  expect(many.p95Ms).toBeLessThan(120);
  expect(worst.medianMs).toBeLessThan(80);
  expect(worst.p95Ms).toBeLessThan(160);
  expect(heapAfter - heapBefore).toBeLessThan(64 * 1024 * 1024);
});
