import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("quality-of-life workflows preserve drafts, gate writes and retain reviewable transactions", async () => {
  const child = Bun.spawn([process.execPath, "test", resolve(import.meta.dir, "fixtures/qol-workflows.check.ts")], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
}, 30000);
