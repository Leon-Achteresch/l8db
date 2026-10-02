import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("connection exports and vault sync keep environment, read-only flag and masking rules", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "test",
      resolve(import.meta.dir, "fixtures/connection-export-safety.check.ts"),
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
