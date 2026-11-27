import { afterEach, expect, test } from "bun:test";
import { saveNotebook } from "../src/lib/notebook/actions";
import type { NotebookDoc, NotebookOutput } from "../src/lib/notebook/model";
import { useNotebookStore } from "../src/lib/notebook/store";

const original = Object.getOwnPropertyDescriptor(window, "__TAURI_INTERNALS__");
const state = () => useNotebookStore.getState();
afterEach(() => {
  if (original) Object.defineProperty(window, "__TAURI_INTERNALS__", original);
  else Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

function setup(size = 1, saveResults = false) {
  const writes: {
    text: string;
    path: string;
    done: ReturnType<typeof Promise.withResolvers<void>>;
  }[] = [];
  const dialogs: string[] = [];
  const doc: NotebookDoc = {
    name: "Bericht",
    connectionId: null,
    saveResults,
    cells: Array.from({ length: size }, (_, i) => ({
      type: "sql",
      source: "select 1",
      id: String(i),
    })),
  };
  state().load(doc, {}, null);
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {
      invoke(command: string, args: Uint8Array, options: { headers: { path: string } }) {
        if (command === "plugin:dialog|save") {
          dialogs.push(command);
          return "/Bericht.l8nb";
        }
        if (command !== "plugin:fs|write_text_file") throw new Error(command);
        const done = Promise.withResolvers<void>();
        writes.push({
          text: new TextDecoder().decode(args),
          path: decodeURIComponent(options.headers.path),
          done,
        });
        return done.promise;
      },
    },
  });
  return { writes, dialogs, doc };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("Speichern unter behält zwischenzeitliche Änderungen und verknüpft den gewählten Pfad", async () => {
  const { writes, dialogs } = setup();
  const first = saveNotebook(true);
  await tick();
  state().patchDoc({ name: "Neu" });
  const second = saveNotebook();
  expect(writes.length).toBe(1);
  expect(JSON.parse(writes[0].text).name).toBe("Bericht");
  writes[0].done.resolve();
  expect(await first).toBe(true);
  expect(state().dirty).toBe(true);
  await tick();
  expect(dialogs.length).toBe(1);
  expect(writes[1].path).toBe("/Bericht.l8nb");
  expect(JSON.parse(writes[1].text).name).toBe("Neu");
  writes[1].done.resolve();
  expect(await second).toBe(true);
  expect(state().dirty).toBe(false);
});

test("ein verspäteter Schreibabschluss übernimmt keinen anderen Entwurf", async () => {
  const { writes } = setup();
  const pending = saveNotebook();
  await tick();
  state().reset(null);
  state().patchDoc({ name: "Anderer Entwurf" });
  writes[0].done.resolve();
  expect(await pending).toBe(true);
  expect(state().filePath).toBeNull();
  expect(state().doc.name).toBe("Anderer Entwurf");
  expect(state().dirty).toBe(true);
  expect(state().recent[0].name).toBe("Bericht");
});

test("Ergebnisänderungen berücksichtigen die Option Ergebnisse mitspeichern", async () => {
  const output: NotebookOutput = {
    columns: ["id"],
    rows: [{ id: 1 }],
    executionMs: 2,
    rowsAffected: null,
    ranAt: 0,
  };
  for (const enabled of [false, true]) {
    const { writes } = setup(1, enabled);
    const pending = saveNotebook();
    await tick();
    state().setOutput("0", output);
    expect(state().dirty).toBe(enabled);
    writes[0].done.resolve();
    await pending;
    expect(state().dirty).toBe(enabled);
  }
});

test("nach einem Schreibfehler kann derselbe Stand erneut gespeichert werden", async () => {
  const { writes } = setup();
  state().patchDoc({ name: "Ungespeichert" });
  const first = saveNotebook();
  await tick();
  writes[0].done.reject(new Error("Testfehler"));
  expect(await first).toBe(false);
  expect(state().dirty).toBe(true);
  const retry = saveNotebook();
  await tick();
  writes[1].done.resolve();
  expect(await retry).toBe(true);
  expect(state().dirty).toBe(false);
});

test("21 Serien mit je 1000 Speicheranforderungen für 5000 Zellen teilen einen Auftrag", async () => {
  const { writes, dialogs } = setup(5000);
  const pending = saveNotebook();
  await tick();
  const times: number[] = [];
  for (let run = 0; run < 22; run++) {
    const start = performance.now();
    let shared = 0;
    for (let i = 0; i < 1000; i++) if (saveNotebook() === pending) shared++;
    if (run) times.push(performance.now() - start);
    expect(shared).toBe(1000);
  }
  writes[0].done.resolve();
  await pending;
  await tick();
  expect(writes.length).toBe(1);
  expect(dialogs.length).toBe(1);
  times.sort((a, b) => a - b);
  console.log(
    `1000 Speicheranforderungen: Median ${times[10].toFixed(3)} ms, p95 ${times[19].toFixed(3)} ms`,
  );
  expect(times[10]).toBeLessThan(3);
  expect(times[19]).toBeLessThan(10);
});
