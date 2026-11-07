import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";

const ROOT = `${import.meta.dir}/../src`;

function sources(pattern: string) {
  return [...new Glob(pattern).scanSync(ROOT)].map((path) => ({
    path,
    text: readFileSync(`${ROOT}/${path}`, "utf8"),
  }));
}

test("scrollers with visible scrollbars never use background-attachment local", () => {
  const offenders: string[] = [];
  for (const { path, text } of sources("**/*.{ts,tsx}"))
    for (const line of text.split("\n"))
      if (/\bbg-local\b/.test(line) && !/no-scrollbar|scrollbar-width:none/.test(line))
        offenders.push(`${path}: ${line.trim()}`);
  for (const { path, text } of sources("**/*.css"))
    if (/background-attachment\s*:\s*[^;]*\blocal\b/.test(text)) offenders.push(path);
  expect(offenders).toEqual([]);
});

test("data grid keeps an opaque scroll background without bg-local", () => {
  const text = readFileSync(`${ROOT}/features/table/data-table/data-table-content.tsx`, "utf8");
  const classes = (pattern: RegExp) =>
    [...text.matchAll(/className=\{?(?:cn\()?\s*"([^"]+)"/g)]
      .map((match) => match[1].split(/\s+/))
      .find((list) => list.some((name) => pattern.test(name)));
  const scroller = classes(/^\[scrollbar-gutter:stable\]$/);
  const content = classes(/^w-max$/);
  expect(scroller).toContain("bg-background");
  expect(scroller).not.toContain("bg-local");
  expect(content).toEqual(expect.arrayContaining(["w-max", "min-w-full", "bg-background"]));
});
