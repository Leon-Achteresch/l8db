import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { ReleaseEntry } from "../src/features/updates/release-entry";
import { parseChangelog } from "../src/lib/changelog";

const source = readFileSync("CHANGELOG.md", "utf8");
const PREVIEW = 6;

test("Changelog wird vollständig in Releases, Gruppen und Einträge zerlegt", () => {
  const releases = parseChangelog(source);
  const bullets = source.split("\n").filter((line) => line.startsWith("- ")).length;
  const items = releases.flatMap((release) => release.groups.flatMap((group) => group.items));
  expect(items).toHaveLength(bullets);
  expect(new Set(releases.map((release) => release.version)).size).toBe(releases.length);
  expect(releases[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(parseChangelog("## [1.0.0]\n- ohne Gruppe")[0]).toEqual({
    version: "1.0.0",
    date: "",
    groups: [{ title: "Änderungen", items: ["ohne Gruppe"] }],
  });
});

test("Release Notes bleiben bei 50-fachem Changelog schnell und rendern begrenzt", async () => {
  const large = Array.from({ length: 50 }, (_, copy) =>
    source.replace(/^## \[/gm, `## [${copy}.`),
  ).join("\n");
  const lines = large.split("\n").length;
  const parse = await measureScenario(() => {
    parseChangelog(large);
  }, 40);
  const releases = parseChangelog(source);
  const largest = releases.reduce((left, right) =>
    right.groups.flatMap((group) => group.items).length >
    left.groups.flatMap((group) => group.items).length
      ? right
      : left,
  );
  const entries = largest.groups.flatMap((group) => group.items).length;
  let rendered = 0;
  const render = await measureScenario(() => {
    const markup = renderToStaticMarkup(
      createElement(ReleaseEntry, { release: largest, latest: true }),
    );
    rendered = markup.split("<li").length - 2;
  }, 40);

  await reportScenario("release-notes", {
    lines,
    parse,
    largestReleaseEntries: entries,
    renderedEntries: rendered,
    render,
  });

  expect(rendered).toBeLessThanOrEqual(largest.groups.length * PREVIEW);
  expect(rendered).toBeLessThan(entries);
  expect(parse.medianMs).toBeLessThan(60);
  expect(parse.p95Ms).toBeLessThan(120);
  expect(render.medianMs).toBeLessThan(15);
});
