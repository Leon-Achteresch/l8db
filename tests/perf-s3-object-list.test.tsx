import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ObjectList } from "../src/features/storage/object-list";
import type { RowActions } from "../src/features/storage/object-row-menu";
import type { BrowserRow } from "../src/features/storage/use-object-listing";

const noop = () => {};
const actions: RowActions = {
  open: noop,
  download: noop,
  rename: noop,
  copy: noop,
  move: noop,
  remove: noop,
  edit: noop,
  presign: noop,
  openExternally: noop,
};

function rows(count: number): BrowserRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `k${index}`,
    kind: index % 50 === 0 ? "folder" : "object",
    key: `data/file-${index}.csv`,
    name: `file-${index}.csv`,
    size: index * 17,
    lastModified: "2026-01-01T00:00:00Z",
    storageClass: "STANDARD",
    etag: null,
  }));
}

function render(list: BrowserRow[], filtered = false) {
  return renderToStaticMarkup(
    createElement(ObjectList, {
      bucket: "b",
      rows: list,
      mode: "objects",
      selected: new Set<string>(),
      selectedRows: [],
      readOnly: false,
      filtered,
      actions,
      onSelect: noop,
      onToggle: noop,
      onToggleAll: noop,
    }),
  );
}

test("object list renders a bounded window of 50 000 rows with one tab stop", () => {
  const list = rows(50_000);
  const samples: number[] = [];
  let markup = "";
  for (let run = 0; run < 15; run++) {
    const started = performance.now();
    markup = render(list);
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  const rendered = markup.match(/data-key=/g)?.length ?? 0;
  console.log(
    `object list 50k rows: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, ${rendered} DOM rows`,
  );
  expect(rendered).toBeGreaterThan(0);
  expect(rendered).toBeLessThanOrEqual(80);
  expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
  expect(median).toBeLessThan(50);
  expect(p95).toBeLessThan(120);
});

test("an empty filter result does not claim the folder is empty", () => {
  expect(render([], true)).toContain("Keine Treffer in den geladenen Einträgen");
  expect(render([])).toContain("Dieser Ordner ist leer.");
});
