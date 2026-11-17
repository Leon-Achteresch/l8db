import { expect, mock, test } from "bun:test";
import { arrayEditorDevelopmentSelected } from "../src/lib/development-entry";

let answer: unknown;
const calls: { command: string; args: unknown }[] = [];
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: unknown) => {
    calls.push({ command, args });
    if (answer instanceof Error) throw answer;
    return answer;
  },
}));
const { arrayEditorDevelopmentContext, updateArrayEditorCell, readArrayEditorFixture } =
  await import("../src/lib/db/array-editor-development");

test("explicit debug flag only, fail-closed native handshake, no regular initialization", async () => {
  expect(arrayEditorDevelopmentSelected(true, "?array-editor-development=1")).toBe(true);
  for (const search of [
    "",
    "?array-editor-development=0",
    "?array-editor-development=1&csv-check-development=1",
    `?${"x".repeat(8192)}`,
  ])
    expect(arrayEditorDevelopmentSelected(true, search)).toBe(false);
  expect(arrayEditorDevelopmentSelected(false, "?array-editor-development=1")).toBe(false);
  for (answer of [
    { ephemeral: false, token: "l8db_a01_012345abcdef" },
    { ephemeral: true, token: "outside" },
    Error("not registered"),
  ])
    await expect(arrayEditorDevelopmentContext()).rejects.toThrow();
  answer = { ephemeral: true, token: "l8db_a01_012345abcdef" };
  expect(await arrayEditorDevelopmentContext()).toEqual(answer);
  const boot = await Bun.file("src/development/array-editor-bootstrap.tsx").text();
  expect(boot.indexOf("await arrayEditorDevelopmentContext()")).toBeLessThan(
    boot.indexOf('await import("./array-editor-development")'),
  );
  const native = await Bun.file("src-tauri/src/lib.rs").text();
  expect(native.indexOf('arg == "--array-editor-development"')).toBeLessThan(
    native.indexOf("desktop::mark_process_start();"),
  );
  expect(native).toContain("#[cfg(debug_assertions)]\nmod array_editor_development;");
  const isolated = await Bun.file("src-tauri/src/array_editor_development.rs").text();
  expect(isolated).toContain(".incognito(true)");
  expect(isolated).not.toContain("automation::init");
  expect(isolated).not.toContain("load_secret");
  const result = await Bun.build({
    entrypoints: ["src/main.tsx"],
    external: ["*"],
    target: "browser",
    define: { "import.meta.env.DEV": "false" },
    minify: { syntax: true },
  });
  const code = await result.outputs[0].text();
  expect(code).not.toContain("array-editor-bootstrap");
  expect(code).not.toContain("csv-check-bootstrap");
  expect(code).toContain('"./bootstrap"');
});

test("write uses existing update_row argument contract without converting exact text; no SQL or automatic action", async () => {
  calls.length = 0;
  answer = undefined;
  const value = "[9007199254740993.1234500,null]";
  await updateArrayEditorCell("l8db_a01_012345abcdef", "(0,1)@1@1", "nums", value);
  expect(calls).toEqual([
    {
      command: "update_row",
      args: {
        kind: "postgres",
        connectionString: "l8db_a01_012345abcdef",
        database: undefined,
        schema: "a01_editor",
        table: "cells",
        ctid: "(0,1)@1@1",
        updates: { nums: value },
      },
    },
  ]);
  await updateArrayEditorCell("l8db_a01_012345abcdef", "(0,1)", "items", null);
  expect((calls[1].args as { updates: unknown }).updates).toEqual({ items: null });
  answer = Error("ragged before UPDATE");
  await expect(
    updateArrayEditorCell("l8db_a01_012345abcdef", "(0,1)", "items", "[[1],[2,3]]"),
  ).rejects.toThrow("ragged");
  answer = { data: { rows: [] }, details: {} };
  expect(await readArrayEditorFixture()).toEqual(answer);
  expect(calls.map((call) => call.command)).toEqual([
    "update_row",
    "update_row",
    "update_row",
    "array_editor_development_read",
  ]);
});
