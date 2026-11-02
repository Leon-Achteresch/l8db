import { expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

test("patched minimatch remains compatible with the shadcn and ts-morph toolchain", async () => {
  const entry = realpathSync(resolve("node_modules/shadcn/dist/index.js"));
  const require = createRequire(entry);
  const { Project } = require("ts-morph");
  const project = new Project();
  const files = project.addSourceFilesAtPaths(["src/lib/team/*.ts", "!src/lib/team/index.ts"]);
  expect(files.length).toBeGreaterThanOrEqual(2);
  expect(files.every((file: { getFilePath(): string }) => file.getFilePath().endsWith(".ts"))).toBe(
    true,
  );
  const child = Bun.spawn([process.execPath, entry, "--help"], { stdout: "pipe", stderr: "pipe" });
  const [code, output, errors] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, errors).toBe(0);
  expect(output).toContain("shadcn");
}, 30000);
