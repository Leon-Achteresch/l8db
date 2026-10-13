import { expect, test } from "bun:test";
import { handleChatNotebookRequest, notebookCells } from "@/lib/ai/notebook";
import { useNotebookStore } from "@/lib/notebook/store";

test("chat notebook cells are validated and bounded", () => {
  expect(notebookCells([])).toBeNull();
  expect(notebookCells([{ type: "python", source: "x" }])).toBeNull();
  expect(
    notebookCells(Array.from({ length: 41 }, () => ({ type: "sql", source: "SELECT 1" }))),
  ).toBeNull();
  const cells = notebookCells([
    { type: "markdown", source: "# Umsatzrückgang" },
    { type: "sql", source: "SELECT 1" },
  ]);
  expect(cells?.map((cell) => cell.type)).toEqual(["markdown", "sql"]);
  expect(new Set(cells?.map((cell) => cell.id)).size).toBe(2);
});

test("chat notebook opens a new unsaved notebook and never overwrites unsaved work", async () => {
  useNotebookStore.getState().reset(null);
  let shown = 0;
  const answer = await handleChatNotebookRequest(
    {
      name: "Warum fiel der Umsatz?",
      connectionId: "conn-1",
      cells: [
        { type: "markdown", source: "DE erklärt 92 % des Rückgangs." },
        { type: "sql", source: "SELECT country, SUM(total) FROM orders GROUP BY country" },
      ],
    },
    async () => {
      shown += 1;
    },
  );
  expect(answer.ok).toBe(true);
  expect(shown).toBe(1);
  const state = useNotebookStore.getState();
  expect(state.doc.name).toBe("Warum fiel der Umsatz?");
  expect(state.doc.connectionId).toBe("conn-1");
  expect(state.doc.cells).toHaveLength(2);
  expect(state.filePath).toBeNull();
  expect(state.dirty).toBe(true);
  const blocked = await handleChatNotebookRequest(
    { name: "Zweites", cells: [{ type: "sql", source: "SELECT 2" }] },
    async () => {
      shown += 1;
    },
  );
  expect(blocked.ok).toBe(false);
  expect(shown).toBe(1);
  expect(useNotebookStore.getState().doc.name).toBe("Warum fiel der Umsatz?");
});

test("perf: validating maximum-size chat notebooks stays fast and bounded", () => {
  const payload = Array.from({ length: 40 }, (_, index) => ({
    type: index % 2 ? "sql" : "markdown",
    source: "x".repeat(4_000),
  }));
  const timings: number[] = [];
  for (let run = 0; run < 200; run++) {
    const started = performance.now();
    const cells = notebookCells(payload);
    timings.push(performance.now() - started);
    expect(cells).toHaveLength(40);
  }
  timings.sort((a, b) => a - b);
  const median = timings[Math.floor(timings.length / 2)];
  const p95 = timings[Math.floor(timings.length * 0.95)];
  expect(median).toBeLessThan(2);
  expect(p95).toBeLessThan(5);
});
