import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildExtension, packageExtension } from "../packages/extension-sdk/src/cli";

test("SDK builds an independent package with bundled code and assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "l8db-sdk-"));
  try {
    const manifest = JSON.parse(await readFile("examples/hello-extension/l8db-extension.json", "utf8"));
    await writeFile(join(root, "l8db-extension.json"), JSON.stringify(manifest));
    await mkdir(join(root, "src")); await mkdir(join(root, "assets"));
    await writeFile(join(root, "src/extension.ts"), 'export function activate(context: unknown, api: any) { api.commands.registerCommand("hello.greet", () => api.notifications.showInfo("Hello")) }');
    await writeFile(join(root, "assets/help.txt"), "extension help");
    await buildExtension(root);
    const archive = await packageExtension(root);
    expect(archive.files["assets/help.txt"]).toBe("extension help");
    const module = { exports: {} as { activate?: unknown } };
    new Function("module", "exports", archive.files[archive.manifest.main])(module, module.exports);
    expect(typeof module.exports.activate).toBe("function");
    const cli = await Bun.build({ entrypoints: ["packages/extension-sdk/src/cli.ts"], target: "bun", format: "esm" });
    expect(cli.success).toBe(true);
    const executable = join(root, "standalone-cli.js");
    await writeFile(executable, await cli.outputs[0].text());
    const output = join(root, "example.l8db-extension");
    const process = Bun.spawn([Bun.which("bun")!, executable, "pack", root, output], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const diagnostics = await new Response(process.stderr).text();
    expect(diagnostics).toBe("");
    expect(await process.exited).toBe(0);
    expect(JSON.parse(await readFile(output, "utf8")).manifest.id).toBe(manifest.id);
    await symlink(join(root, "src/extension.ts"), join(root, "assets/link.txt"));
    await expect(packageExtension(root)).rejects.toThrow("symlinks");
  } finally { await rm(root, { recursive: true, force: true }) }
});
