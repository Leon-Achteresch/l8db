import { describe, expect, test } from "bun:test";
import { apiVersions, validateManifest } from "../packages/extension-api/src/manifest";
import { PERMISSION_LABELS } from "../src/features/community-extensions/permission-labels";
import type { Json } from "../src/lib/extensions/contracts";
import { HIDDEN_RANGE_LIMIT } from "../src/lib/extensions/registries";
import { editorArchive, editorHost, fakeEditor } from "./fixtures/extension-editor-host";

async function code(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    return (error as Error).name;
  }
  return "resolved";
}

const ID = "test.logs";
const COMMAND = "test.logs.toggle";
const SOURCE = [
  "BEGIN",
  "  DBMS_OUTPUT.PUT_LINE('start');",
  "  UPDATE konto SET saldo = saldo - 1;",
  "  DBMS_OUTPUT.PUT_LINE(",
  "    'fertig');",
  "END;",
].join("\n");
const LOGS = [
  { startLine: 2, endLine: 2 },
  { startLine: 4, endLine: 5 },
];

describe("extension API 1.2 manifest", () => {
  test("accepts editor/toolbar, editor:read and ^1.2.0", () => {
    const manifest = validateManifest(editorArchive().manifest);
    expect(apiVersions).toEqual(["^1.0.0", "^1.1.0", "^1.2.0"]);
    expect(manifest.engines.api).toBe("^1.2.0");
    expect(manifest.permissions).toEqual(["editor:read"]);
    expect(manifest.contributes?.menus?.[0].location).toBe("editor/toolbar");
  });
  test("consent UI names the permission and its risk", () => {
    expect(PERMISSION_LABELS["editor:read"]).toContain("Passwörter");
  });
});

describe("editor:read permission", () => {
  test("every editor call is denied at the host without the grant", async () => {
    const { manager, call } = await editorHost(editorArchive(ID, []));
    const editor = fakeEditor(SOURCE);
    manager.editors.register("e1", editor.source);
    for (const [method, args] of [
      ["editor.getText", ["e1"]],
      ["editor.onDidChangeText", []],
      ["editor.setHiddenRanges", ["e1", 1, LOGS]],
      ["editor.clearHiddenRanges", ["e1"]],
    ] as [string, Json[]][])
      expect(await code(call(ID, method, ...args))).toBe("PermissionDeniedError");
    expect(editor.state.hidden).toEqual([]);
    expect(editor.watchers.size).toBe(0);
  });
  test("a declared but ungranted permission is denied as well", async () => {
    const { manager, call } = await editorHost();
    await manager.installExtension(editorArchive());
    await manager.enableExtension(ID, []);
    await manager.activate(ID);
    manager.editors.register("e1", fakeEditor(SOURCE).source);
    expect(await code(call(ID, "editor.getText", "e1"))).toBe("PermissionDeniedError");
    expect(manager.permissions.supported).toContain("editor:read");
  });
});

describe("editor text, versions and hidden ranges", () => {
  test("getText returns the full text and a version that every change increments", async () => {
    const { manager, call } = await editorHost(editorArchive());
    const editor = fakeEditor(SOURCE);
    manager.editors.register("e1", editor.source);
    expect(await call(ID, "editor.getText", "e1")).toEqual({ text: SOURCE, version: 1 });
    editor.type(`${SOURCE}\n`);
    expect(await call(ID, "editor.getText", "e1")).toEqual({ text: `${SOURCE}\n`, version: 2 });
    expect(await code(call(ID, "editor.getText", "missing"))).toBe("EditorNotFoundError");
  });
  test("setHiddenRanges with a stale version is rejected", async () => {
    const { manager, call } = await editorHost(editorArchive());
    const editor = fakeEditor(SOURCE);
    manager.editors.register("e1", editor.source);
    const { version } = (await call(ID, "editor.getText", "e1")) as { version: number };
    editor.type(`-- neu\n${SOURCE}`);
    expect(await code(call(ID, "editor.setHiddenRanges", "e1", version, LOGS))).toBe(
      "StaleEditorVersionError",
    );
    expect(editor.state.hidden).toEqual([]);
    await call(ID, "editor.setHiddenRanges", "e1", version + 1, [{ startLine: 3, endLine: 3 }]);
    expect(editor.state.hidden).toEqual([{ startLine: 3, endLine: 3 }]);
  });
  test("an edit drops hidden ranges and reports only editorId and version", async () => {
    const { manager, runtime, call } = await editorHost(editorArchive());
    const editor = fakeEditor(SOURCE);
    manager.editors.register("e1", editor.source);
    await call(ID, "editor.onDidChangeText");
    await call(ID, "editor.setHiddenRanges", "e1", 1, LOGS);
    expect(editor.state.hidden).toEqual(LOGS);
    editor.type(`${SOURCE}\n-- geheim`);
    expect(editor.state.hidden).toEqual([]);
    expect(manager.editors.hiddenRanges("e1")).toEqual([]);
    expect(runtime.events).toEqual([
      { id: ID, name: "editorTextChanged", payload: { editorId: "e1", version: 2 } },
    ]);
    expect(JSON.stringify(runtime.events)).not.toContain("geheim");
  });
  test("hiding never changes the text that run, save and copy read", async () => {
    const { manager, call } = await editorHost(editorArchive());
    const editor = fakeEditor(SOURCE);
    manager.editors.register("e1", editor.source);
    await call(ID, "editor.setHiddenRanges", "e1", 1, LOGS);
    expect(editor.state.text).toBe(SOURCE);
    expect(editor.source.text()).toBe(SOURCE);
    expect(await call(ID, "editor.getText", "e1")).toEqual({ text: SOURCE, version: 1 });
    await call(ID, "editor.clearHiddenRanges", "e1");
    expect(editor.state.hidden).toEqual([]);
    expect(editor.state.text).toBe(SOURCE);
  });
  test("ranges are validated at the RPC boundary", async () => {
    const { manager, call } = await editorHost(editorArchive());
    const editor = fakeEditor(SOURCE);
    manager.editors.register("e1", editor.source);
    const bad: Json[] = [
      "2-3",
      [{ startLine: 0, endLine: 1 }],
      [{ startLine: 2, endLine: 7 }],
      [{ startLine: 3, endLine: 2 }],
      [{ startLine: 1.5, endLine: 2 }],
      [{ startLine: "2", endLine: 2 }],
      [{ startLine: 2 }],
      [null],
      [[2, 3]],
      [{ startLine: 1, endLine: 6 }],
      [
        { startLine: 1, endLine: 3 },
        { startLine: 4, endLine: 6 },
      ],
      Array.from({ length: HIDDEN_RANGE_LIMIT + 1 }, () => ({ startLine: 2, endLine: 2 })),
    ];
    for (const ranges of bad)
      expect(await code(call(ID, "editor.setHiddenRanges", "e1", 1, ranges))).toBe("ProtocolError");
    expect(await code(call(ID, "editor.setHiddenRanges", "e1", "1", LOGS))).toBe(
      "StaleEditorVersionError",
    );
    expect(editor.state.hidden).toEqual([]);
    await call(ID, "editor.setHiddenRanges", "e1", 1, [
      { startLine: 4, endLine: 5, extra: "x" },
      { startLine: 2, endLine: 3 },
      { startLine: 3, endLine: 3 },
    ] as unknown as Json);
    expect(editor.state.hidden).toEqual([{ startLine: 2, endLine: 5 }]);
  });
  test("two extensions hide independently and the user can expand a marker", async () => {
    const { manager, call } = await editorHost(editorArchive(), editorArchive("test.other"));
    const editor = fakeEditor(SOURCE);
    manager.editors.register("e1", editor.source);
    await call(ID, "editor.setHiddenRanges", "e1", 1, [{ startLine: 2, endLine: 2 }]);
    await call("test.other", "editor.setHiddenRanges", "e1", 1, [{ startLine: 4, endLine: 5 }]);
    expect(editor.state.hidden).toEqual(LOGS);
    expect(
      await code(
        call("test.other", "editor.setHiddenRanges", "e1", 1, [
          { startLine: 1, endLine: 1 },
          { startLine: 3, endLine: 6 },
        ]),
      ),
    ).toBe("ProtocolError");
    manager.editors.reveal("e1", 4);
    expect(editor.state.hidden).toEqual([{ startLine: 2, endLine: 2 }]);
    await call(ID, "editor.clearHiddenRanges", "e1");
    expect(editor.state.hidden).toEqual([]);
  });
});

describe("editor/toolbar entries", () => {
  test("the command receives the editor context without any text", async () => {
    const { manager, runtime } = await editorHost(editorArchive(ID, []));
    manager.editors.register("e1", fakeEditor(SOURCE, "package-body").source);
    await manager.executeEditorCommand(COMMAND, "e1");
    expect(runtime.executed).toEqual([
      {
        command: COMMAND,
        payload: { editorId: "e1", editorKind: "package-body", connectionKind: "oracle" },
      },
    ]);
    expect(await code(manager.executeEditorCommand(COMMAND, "missing"))).toBe(
      "EditorNotFoundError",
    );
    expect(await code(manager.executeEditorCommand("unknown", "e1"))).toBe("CommandNotFoundError");
  });
  test("setChecked toggles per editor and only for own toolbar commands", async () => {
    const { manager, call } = await editorHost(editorArchive(ID, []), editorArchive("test.other"));
    manager.editors.register("e1", fakeEditor(SOURCE).source);
    manager.editors.register("e2", fakeEditor(SOURCE).source);
    let changes = 0;
    manager.changes.on("change", () => {
      changes += 1;
    });
    await call(ID, "commands.setChecked", COMMAND, "e1", true);
    expect(manager.editors.isChecked("e1", COMMAND)).toBe(true);
    expect(manager.editors.isChecked("e2", COMMAND)).toBe(false);
    expect(changes).toBe(1);
    await call(ID, "commands.setChecked", COMMAND, "e1", false);
    expect(manager.editors.isChecked("e1", COMMAND)).toBe(false);
    expect(await code(call("test.other", "commands.setChecked", COMMAND, "e1", true))).toBe(
      "CommandNotFoundError",
    );
    expect(await code(call(ID, "commands.setChecked", COMMAND, "missing", true))).toBe(
      "EditorNotFoundError",
    );
    expect(await code(call(ID, "commands.setChecked", COMMAND, "e1", "yes"))).toBe("ProtocolError");
  });
});

describe("editor state lifecycle", () => {
  async function hidden() {
    const host = await editorHost(editorArchive());
    const editor = fakeEditor(SOURCE);
    const registration = host.manager.editors.register("e1", editor.source);
    await host.call(ID, "editor.onDidChangeText");
    await host.call(ID, "editor.setHiddenRanges", "e1", 1, LOGS);
    await host.call(ID, "commands.setChecked", COMMAND, "e1", true);
    return { ...host, editor, registration };
  }
  const cleared = ({ manager, runtime, editor }: Awaited<ReturnType<typeof hidden>>) => {
    expect(editor.state.hidden).toEqual([]);
    expect(manager.editors.isChecked("e1", COMMAND)).toBe(false);
    editor.type(`${SOURCE}\n`);
    expect(runtime.events).toEqual([]);
    expect(editor.watchers.size).toBe(0);
  };
  test("disabling clears hidden ranges, toggle state and the subscription", async () => {
    const host = await hidden();
    await host.manager.disableExtension(ID);
    cleared(host);
  });
  test("uninstalling clears them", async () => {
    const host = await hidden();
    await host.manager.uninstallExtension(ID);
    cleared(host);
  });
  test("a crash clears them", async () => {
    const host = await hidden();
    host.runtime.failures.get(ID)!(new Error("worker crashed"));
    expect(host.manager.listExtensions()[0].state).toBe("failed");
    cleared(host);
  });
  test("closing an editor releases its state and listeners", async () => {
    const { manager, editor, call, registration } = await hidden();
    registration.dispose();
    registration.dispose();
    expect(manager.editors.size()).toBe(0);
    expect(editor.watchers.size).toBe(0);
    expect(manager.editors.isChecked("e1", COMMAND)).toBe(false);
    expect(await code(call(ID, "editor.getText", "e1"))).toBe("EditorNotFoundError");
    await call(ID, "editor.clearHiddenRanges", "e1");
  });
  test("typing costs nothing until an extension reads or subscribes", async () => {
    const { manager, runtime, call } = await editorHost(editorArchive());
    const editor = fakeEditor(SOURCE);
    manager.editors.register("e1", editor.source);
    expect(editor.watchers.size).toBe(0);
    await call(ID, "editor.getText", "e1");
    expect(editor.watchers.size).toBe(1);
    editor.type(`${SOURCE}\n`);
    expect(editor.watchers.size).toBe(0);
    expect(runtime.events).toEqual([]);
    expect(await call(ID, "editor.getText", "e1")).toEqual({ text: `${SOURCE}\n`, version: 2 });
  });
});
