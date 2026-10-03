import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("tunnel failures preserve transient tunnels and reopen failed tunnels in isolation", async () => {
  const child = Bun.spawn(
    [process.execPath, "test", resolve(import.meta.dir, "fixtures/ssh-tunnel-failures.check.ts")],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
}, 30000);
