import { expect, test } from "bun:test";

test("Extension-Secret wird bei Löschung und Deinstallation aus dem Schlüsselbund entfernt", async () => {
  const process = Bun.spawn(["bun", "tests/fixtures/extension-storage-check.ts"], {
    cwd: import.meta.dir + "/..",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
