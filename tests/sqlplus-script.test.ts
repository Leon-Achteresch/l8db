import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("Oracle scripts run SQL*Plus commands in the script runner", async () => {
  const child = Bun.spawn(
    [process.execPath, "test", resolve(import.meta.dir, "fixtures/sqlplus-script.check.ts")],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
}, 60000);
