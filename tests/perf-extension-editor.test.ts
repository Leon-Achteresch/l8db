import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { arch, cpus, platform, release, totalmem } from "node:os";
import type { Json } from "../src/lib/extensions/contracts";
import { editorArchive, editorHost, fakeEditor } from "./fixtures/extension-editor-host";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

const ID = "test.logs";
const COMMAND = "test.logs.toggle";
const LINES = 10_000;
const RANGES = 3_000;
const KEYSTROKES = 1_000;

function packageBody(revision = 0) {
  return Array.from({ length: LINES }, (_, index) =>
    index % 3 === 1
      ? `    DBMS_OUTPUT.PUT_LINE('schritt ${index} rev ${revision}');`
      : `    l_summe := l_summe + f_betrag(p_konto => ${index});`,
  ).join("\n");
}
const ranges = Array.from({ length: RANGES }, (_, index) => ({
  startLine: index * 3 + 2,
  endLine: index * 3 + 2,
})) as unknown as Json;
const environment = {
  os: platform(),
  release: release(),
  arch: arch(),
  cpu: cpus()[0]?.model,
  ramBytes: totalmem(),
  bun: Bun.version,
};

test("3,000 hidden ranges in a 10,000-line editor stay cheap to set, retype and idle", async () => {
  const { manager, runtime, call } = await editorHost(editorArchive());
  const editor = fakeEditor(packageBody());
  manager.editors.register("e1", editor.source);
  await call(ID, "editor.onDidChangeText");

  const hide = await measureScenario(async () => {
    const { version } = (await call(ID, "editor.getText", "e1")) as { version: number };
    await call(ID, "editor.setHiddenRanges", "e1", version, ranges);
  }, 41);
  expect(editor.state.hidden).toHaveLength(RANGES);

  let revision = 0;
  const texts = Array.from({ length: 4 }, (_, index) => packageBody(index + 1));
  const typing = await measureScenario(() => {
    for (let index = 0; index < KEYSTROKES; index++) editor.type(texts[revision++ % texts.length]);
  }, 21);
  expect(editor.state.hidden).toEqual([]);
  const events = runtime.events.length;
  expect(events).toBe((21 + 2) * KEYSTROKES);
  expect(Math.max(...runtime.events.map((event) => JSON.stringify(event).length))).toBeLessThan(
    120,
  );
  runtime.events.length = 0;

  const cycle = await measureScenario(async () => {
    editor.type(texts[revision++ % texts.length]);
    const { version } = (await call(ID, "editor.getText", "e1")) as { version: number };
    await call(ID, "editor.setHiddenRanges", "e1", version, ranges);
  }, 41);

  expect(runtime.events).toHaveLength(41 + 2);
  runtime.events.length = 0;
  await manager.disableExtension(ID);
  const idle = editor.state.applied;
  for (let index = 0; index < KEYSTROKES; index++) editor.type(texts[index % texts.length]);
  expect(editor.watchers.size).toBe(0);
  expect(editor.state.applied).toBe(idle);
  expect(runtime.events).toHaveLength(0);

  reportScenario("extension-editor-hidden-ranges", {
    lines: LINES,
    ranges: RANGES,
    setHiddenRanges: hide,
    keystrokesPerRun: KEYSTROKES,
    typingWithSubscriber: typing,
    typeAndRehide: cycle,
    eventsPerKeystroke: 1,
    idleCallbacksAfterDisable: 0,
    dbRequests: 0,
    environment,
  });
  expect(hide.medianMs).toBeLessThan(2);
  expect(hide.p95Ms).toBeLessThan(5);
  expect(typing.medianMs).toBeLessThan(2);
  expect(typing.p95Ms).toBeLessThan(5);
  expect(cycle.medianMs).toBeLessThan(2);
  expect(cycle.p95Ms).toBeLessThan(5);
});

test("closed editors retain no hidden ranges, toggles or listeners", async () => {
  const { manager, call } = await editorHost(editorArchive());
  await call(ID, "editor.onDidChangeText");
  const text = packageBody();
  const cycle = async () => {
    const open = Array.from({ length: 50 }, (_, index) => {
      const editor = fakeEditor(text);
      return { editor, registration: manager.editors.register(`e${index}`, editor.source) };
    });
    for (let index = 0; index < open.length; index++) {
      await call(ID, "editor.setHiddenRanges", `e${index}`, 1, ranges);
      await call(ID, "commands.setChecked", COMMAND, `e${index}`, true);
    }
    for (const { editor, registration } of open) {
      registration.dispose();
      if (editor.watchers.size) throw new Error("listener survived the editor");
    }
  };
  await cycle();
  Bun.gc(true);
  const before = heapStats().heapSize;
  for (let index = 0; index < 5; index++) await cycle();
  Bun.gc(true);
  const retainedBytes = Math.max(0, heapStats().heapSize - before);
  reportScenario("extension-editor-retained", {
    editorsPerCycle: 50,
    cycles: 5,
    rangesPerEditor: RANGES,
    openEditors: manager.editors.size(),
    retainedBytes,
    environment,
  });
  expect(manager.editors.size()).toBe(0);
  expect(retainedBytes).toBeLessThan(512 * 1024);
});
