import { expect, mock, test } from "bun:test";
import { csvCheckDevelopmentSelected } from "../src/lib/development-entry";

let answer: unknown;
const commands: string[] = [];
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    commands.push(command);
    if (answer instanceof Error) throw answer;
    return answer;
  },
}));
const { csvCheckDevelopmentContext } = await import("../src/lib/db/csv-check-development");

test("development entry requires DEV and explicit query; normal/release stay normal", () => {
  expect(csvCheckDevelopmentSelected(true, "?csv-check-development=1")).toBe(true);
  for (const search of [
    "",
    "?csv-check-development=0",
    "?csv-check-development=true",
    `?${"x".repeat(8192)}`,
  ])
    expect(csvCheckDevelopmentSelected(true, search)).toBe(false);
  expect(csvCheckDevelopmentSelected(false, "?csv-check-development=1")).toBe(false);
});

test("native handshake fails closed before loading any ordinary store/service", async () => {
  for (answer of [
    { ephemeral: false, directory: "/synthetic" },
    { ephemeral: true, directory: "" },
    Error("unregistered in normal app"),
  ])
    await expect(csvCheckDevelopmentContext()).rejects.toThrow();
  answer = { ephemeral: true, directory: "/synthetic-fresh" };
  expect(await csvCheckDevelopmentContext()).toEqual(answer);
  expect(commands).toEqual(Array(4).fill("csv_check_development_context"));
});

test("production entry compilation removes debug loader and preserves ordinary bootstrap", async () => {
  const result = await Bun.build({
    entrypoints: ["src/main.tsx"],
    external: ["*"],
    target: "browser",
    define: { "import.meta.env.DEV": "false" },
    minify: { syntax: true },
  });
  expect(result.success).toBe(true);
  const code = await result.outputs[0].text();
  expect(code).not.toContain("csv-check-bootstrap");
  expect(code).toContain("./bootstrap");
});

test("native branch precedes regular initialization and registers only read/check/cancel", async () => {
  const source = await Bun.file("src-tauri/src/lib.rs").text();
  expect(source).toContain("#[cfg(debug_assertions)]\nmod csv_check_development;");
  const run = source.slice(source.indexOf("pub fn run()"));
  expect(run.indexOf('"--csv-check-development"')).toBeLessThan(
    run.indexOf("desktop::mark_process_start"),
  );
  expect(run.slice(0, run.indexOf("desktop::mark_process_start"))).toContain(
    "#[cfg(not(debug_assertions))]",
  );
  const isolated = await Bun.file("src-tauri/src/csv_check_development.rs").text();
  const registered = isolated
    .split("tauri::generate_handler![")[1]
    .split("]")[0]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  expect(registered).toEqual([
    "csv_check_development_context",
    "read_csv_preview",
    "check_csv_file",
    "crate::db::commands::cancel_execution",
  ]);
  expect(isolated).toContain(".incognito(true)");
  expect(isolated).toContain(".data_directory(data_directory)");
  expect(isolated).not.toContain("automation::init");
  const boot = await Bun.file("src/development/csv-check-bootstrap.tsx").text();
  expect(boot.indexOf("await csvCheckDevelopmentContext()")).toBeLessThan(
    boot.indexOf('await import("./csv-check-development")'),
  );
});
