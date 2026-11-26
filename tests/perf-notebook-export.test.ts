import { afterEach, expect, spyOn, test } from "bun:test";
import { exportNotebook } from "../src/lib/notebook/actions";
import { useNotebookStore } from "../src/lib/notebook/store";

const originalBridge = Object.getOwnPropertyDescriptor(window, "__TAURI_INTERNALS__");
afterEach(() => {
  if (originalBridge) Object.defineProperty(window, "__TAURI_INTERNALS__", originalBridge);
  else Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

function installBridge(invoke: (command: string, args: unknown) => unknown) {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: { invoke } });
}

test("Abbruch bei 100 SQL-Zellen mit je 1000 Zeilen liest und schreibt keine Ergebnisse", async () => {
  const state = useNotebookStore.getState();
  let reads = 0;
  const cells = Array.from({ length: 100 }, (_, i) => ({
    type: "sql" as const,
    id: String(i),
    source: "SELECT v",
  }));
  const outputs = Object.fromEntries(
    cells.map(({ id }) => [
      id,
      {
        columns: ["v"],
        rows: Array.from({ length: 1000 }, (_, i) => ({
          get v() {
            reads++;
            return i;
          },
        })),
        ranAt: 0,
        executionMs: 1,
        rowsAffected: null,
      },
    ]),
  );
  const snapshot = spyOn(useNotebookStore, "getState").mockReturnValue({
    ...state,
    doc: { ...state.doc, cells },
    outputs,
  });
  const calls: string[] = [];
  installBridge((command) => {
    calls.push(command);
    return null;
  });
  try {
    const times: number[] = [];
    for (let run = 0; run < 22; run++) {
      const then = performance.now();
      await exportNotebook(run % 2 ? "html" : "md");
      if (run) times.push(performance.now() - then);
    }
    times.sort((a, b) => a - b);
    console.log(
      `Notebook-Export abgebrochen: Median ${times[10].toFixed(3)} ms, p95 ${times[19].toFixed(3)} ms, ${reads} Zellzugriffe`,
    );
    expect(calls).toEqual(Array(22).fill("plugin:dialog|save"));
    expect(reads).toBe(0);
    expect(times[10]).toBeLessThan(3);
    expect(times[19]).toBeLessThan(10);
  } finally {
    snapshot.mockRestore();
  }
});

test("Bestätigung exportiert den beim Öffnen gewählten Stand genau einmal", async () => {
  const state = useNotebookStore.getState();
  const doc = {
    ...state.doc,
    name: "Bericht",
    cells: [{ type: "markdown" as const, id: "intro", source: "Stand beim Öffnen" }],
  };
  const snapshot = spyOn(useNotebookStore, "getState").mockReturnValue({
    ...state,
    doc,
    outputs: {},
  });
  const writes: string[] = [];
  const dialog = Promise.withResolvers<string>();
  installBridge((command, data) => {
    if (command === "plugin:dialog|save") return dialog.promise;
    if (command === "plugin:fs|write_text_file")
      writes.push(new TextDecoder().decode(data as Uint8Array));
  });
  try {
    const pending = exportNotebook("md");
    snapshot.mockReturnValue(state);
    expect(writes).toEqual([]);
    dialog.resolve("/berichte/Bericht.md");
    await pending;
    expect(writes).toEqual(["Stand beim Öffnen\n"]);
  } finally {
    snapshot.mockRestore();
  }
});
