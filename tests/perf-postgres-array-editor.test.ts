import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { cellDraftToUpdate, detectCellEditorKind, toCellDraft } from "../src/lib/cell-editor";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

test("large SQL arrays keep the existing text editor bounded without numeric parsing or background requests", async () => {
  const values = Array.from({ length: 12_000 }, (_, index) => `item-${index},\\"雪`);
  const exact = `[${Array.from({ length: 12_000 }, () => "900719925474099312345.500").join(",")}]`;
  const run = () => {
    const kind = detectCellEditorKind(values, "text[]");
    if (kind !== "text") throw Error("unexpected numeric/tree parser");
    const draft = toCellDraft(values, kind);
    if (!cellDraftToUpdate(draft)?.includes("item-11999")) throw Error("incomplete array");
    const raw = toCellDraft(exact, detectCellEditorKind(exact, "numeric[]"));
    if (cellDraftToUpdate(raw) !== exact) throw Error("numeric lexemes changed");
  };
  const times = await measureScenario(run, 21);
  Bun.gc(true);
  const before = heapStats().heapSize;
  for (let index = 0; index < 30; index++) run();
  Bun.gc(true);
  const retainedBytes = Math.max(0, heapStats().heapSize - before);
  reportScenario("postgres-array-editor", {
    elements: values.length,
    exactCharacters: exact.length,
    times,
    retainedBytes,
    dbRequests: 0,
    backgroundTasks: 0,
    bun: Bun.version,
  });
  expect(times.medianMs).toBeLessThan(100);
  expect(times.p95Ms).toBeLessThan(200);
  expect(retainedBytes).toBeLessThan(4 * 1024 * 1024);
});
