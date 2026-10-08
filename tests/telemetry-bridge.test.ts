import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("usage instrumentation preserves bridge requests, concurrency and failures", async () => {
  const child = Bun.spawn(
    [process.execPath, "test", resolve(import.meta.dir, "fixtures/telemetry-bridge.check.ts")],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
}, 30000);
