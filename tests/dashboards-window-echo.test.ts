import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("dashboards stay consistent between two windows without stale echoes", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "test",
      resolve(import.meta.dir, "fixtures/dashboards-window-echo.check.ts"),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
}, 30000);
