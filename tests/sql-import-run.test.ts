import { afterAll, beforeEach, expect, test } from "bun:test";
import type { ScriptRunEntry } from "@/features/query/script-result-list";
import { createChangedOnlyJsonStorage } from "@/lib/buffered-storage";
import {
  beginSqlImport,
  EMPTY_SQL_IMPORT,
  selectSqlImportFile,
  useImportWorkspace,
} from "@/lib/import-workspace";

const storage = new Map<string, string>();
let writes = 0;
const options = useImportWorkspace.persist.getOptions();
const previous = useImportWorkspace.getState();
useImportWorkspace.persist.setOptions({
  storage: createChangedOnlyJsonStorage(() => ({
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => {
      writes++;
      storage.set(key, value);
    },
    removeItem: (key) => storage.delete(key),
  })),
});
beforeEach(() => {
  storage.clear();
  useImportWorkspace.setState({ sql: {}, csv: {} });
});
afterAll(() => {
  useImportWorkspace.setState(previous);
  useImportWorkspace.persist.setOptions(options);
});

const file = { path: "/fixture/source.sql", name: "source.sql", text: "SELECT 1;" };
const other = { path: "/fixture/next.sql", name: "next.sql", text: "SELECT 2;" };
const key = '["local","sales"]';
const draft = () => useImportWorkspace.getState().sql[key];

function start(scope = key) {
  const run = beginSqlImport(scope);
  if (!run) throw new Error("Der Testimport konnte nicht gestartet werden");
  return run;
}
const entries: ScriptRunEntry[] = Array.from({ length: 2048 }, (_, index) => ({
  index,
  sql: `SELECT ${index};`,
  start: 0,
  end: 10,
  status: "success",
  durationMs: 1,
  rowCount: 1,
  rowsAffected: null,
  error: null,
}));

test("reselecting a file during preparation isolates its old job, results and error", () => {
  useImportWorkspace.getState().patchSql(key, {
    ...EMPTY_SQL_IMPORT,
    fileName: file.name,
    filePath: file.path,
    sql: file.text,
  });
  const old = start();
  selectSqlImportFile(key, file);
  expect(beginSqlImport(key)).toBeNull();
  selectSqlImportFile("other", other);
  const parallel = start("other");
  parallel.onJob("separate");
  old.onJob("late");
  expect(draft().activeRun?.jobId).toBe("late");
  expect(draft().jobId).toBeNull();
  old.onProgress(entries);
  expect(draft().entries).toBeNull();
  expect(old.finish("Fehler in der alten Auswahl")).toBe(false);
  expect(draft().error).toBeNull();
  const next = start();
  next.onJob("next");
  next.onProgress(entries);
  old.onJob("obsolete");
  old.onProgress([]);
  old.finish("verspätet");
  expect(draft().jobId).toBe("next");
  expect(draft().entries).toBe(entries);
  expect(draft().activeRun?.jobId).toBe("next");
  expect(next.finish("Fehler der aktuellen Auswahl")).toBe(true);
  expect(draft().error).toBe("Fehler der aktuellen Auswahl");
  const saved = JSON.parse(storage.get("l8db.import-workspace") ?? "null").state.sql[key];
  expect(saved.jobId).toBe("next");
  expect(saved.activeRun).toBeUndefined();
  expect(saved.error).toBeUndefined();
  expect(saved.entries).toBeNull();
  expect(saved.sql).toBeNull();
  expect(useImportWorkspace.getState().sql.other.activeRun?.jobId).toBe("separate");
  parallel.finish(null);
  selectSqlImportFile(key, other);
  expect(draft().error).toBeNull();
});

test("1,000 progress deliveries for a replaced 2,048-statement script create no draft writes", () => {
  const samples: number[] = [];
  for (let pass = 0; pass <= 21; pass++) {
    selectSqlImportFile(key, file);
    const execution = start();
    execution.onJob("old");
    const attachedWrites = writes;
    execution.onProgress(entries);
    expect(writes).toBe(attachedWrites);
    selectSqlImportFile(key, other);
    const before = draft();
    const stored = writes;
    let changes = 0;
    const unsubscribe = useImportWorkspace.subscribe(() => {
      changes++;
    });
    try {
      const start = performance.now();
      for (let i = 0; i < 1000; i++) execution.onProgress(entries);
      if (pass) samples.push(performance.now() - start);
      expect(draft()).toBe(before);
      expect(draft().entries).toBeNull();
      expect(changes).toBe(0);
      expect(writes).toBe(stored);
    } finally {
      unsubscribe();
      execution.finish(null);
    }
  }
  samples.sort((a, b) => a - b);
  console.log("Detached SQL import", { medianMs: samples[10], p95Ms: samples[19] });
  expect(samples[10]).toBeLessThan(1);
  expect(samples[19]).toBeLessThan(3);
});
