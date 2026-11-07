import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("the test runner isolates module mocks and propagates failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "l8db-test-isolation-"));
  try {
    const shared = join(root, "shared.ts");
    await writeFile(shared, "export const value = 1;");
    const first = join(root, "isolated-first.test.ts");
    const second = join(root, "isolated-second.test.ts");
    await writeFile(
      first,
      `import { test, expect, mock } from "bun:test"; mock.module(${JSON.stringify(shared)}, () => ({value:2})); test("mock", async () => expect((await import(${JSON.stringify(shared)})).value).toBe(2));`,
    );
    await writeFile(
      second,
      `import { test, expect } from "bun:test"; import { value } from ${JSON.stringify(shared)}; test("original", () => expect(value).toBe(1));`,
    );
    const run = async (files: string[]) => {
      const child = Bun.spawn([process.execPath, resolve("scripts/test-tests.ts"), ...files], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, out, err] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { code, output: out + err };
    };
    expect((await run([first, second])).code).toBe(0);
    await writeFile(
      second,
      'import { test, expect } from "bun:test"; test("failure", () => expect(1).toBe(2));',
    );
    const failed = await run([second]);
    expect(failed.code).toBe(1);
    expect(failed.output).toContain("FAIL");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
