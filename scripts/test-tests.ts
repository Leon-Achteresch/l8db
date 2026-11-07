import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { selectTestFiles } from "./test-selection";

const args = process.argv.slice(2);
const explicit = args.some((arg) => /\.test\.[cm]?[jt]sx?$/.test(arg));
const discovered = explicit
  ? []
  : (
      await Array.fromAsync(new Bun.Glob("**/*.test.{ts,tsx,js,mjs,cjs}").scan({ cwd: "tests" }))
    ).map((file) => `tests/${file}`);
const { flags, files } = selectTestFiles(args, discovered);
if (!files.length) throw new Error("Keine Testdateien gefunden.");
const directory = resolve("test-artifacts/unit");
await mkdir(directory, { recursive: true });
let failed = 0;
let passed = 0;
let skipped = 0;
for (const file of files) {
  const child = Bun.spawn([process.execPath, "test", file, ...flags], {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const output = stdout + stderr;
  await writeFile(resolve(directory, `${basename(file)}.log`), output);
  passed += Number(output.match(/(?:^|\n)\s*(\d+) pass\b/)?.[1] ?? 0);
  skipped += Number(output.match(/(?:^|\n)\s*(\d+) skip\b/)?.[1] ?? 0);
  if (code !== 0) {
    failed++;
    console.error(`FAIL ${file}\n${output}`);
  } else console.log(`PASS ${file}`);
}
console.log(
  `${files.length} isolierte Dateien, ${passed} bestandene Tests, ${skipped} übersprungene Tests, ${failed} fehlgeschlagene Dateien. Logs: ${directory}`,
);
process.exitCode = failed ? 1 : 0;
