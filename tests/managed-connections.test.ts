import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("managed connection pointers preserve profiles, safety and bounded foreground work", async () => {
  const child = Bun.spawn(
    [process.execPath, "test", resolve(import.meta.dir, "fixtures/managed-connections.check.ts")],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (stdout) console.log(stdout.trim());
  expect(code, `${stdout}\n${stderr}`).toBe(0);
}, 30000);
