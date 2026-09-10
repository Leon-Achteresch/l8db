#!/usr/bin/env bun
import { mkdir, readFile, readdir, realpath, writeFile, lstat } from "node:fs/promises";
import { resolve, relative, join } from "node:path";
import { validateArchive, validateManifest, safePath } from "@l8db/extension-api/manifest";

export async function buildExtension(directory: string) {
  const root = await realpath(resolve(directory));
  const manifest = validateManifest(JSON.parse(await readFile(join(root, "l8db-extension.json"), "utf8")));
  const result = await Bun.build({ entrypoints: [join(root, "src/extension.ts")], target: "browser", format: "cjs", minify: false, sourcemap: "none", packages: "bundle" });
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
  if (result.outputs.length !== 1) throw new Error("Extensions must produce a single bundled entry point");
  const destination = join(root, manifest.main);
  await mkdir(resolve(destination, ".."), { recursive: true });
  const actualParent = await realpath(resolve(destination, ".."));
  if (relative(root, actualParent).startsWith("..")) throw new Error("Output path escapes project directory");
  try { if ((await lstat(destination)).isSymbolicLink()) throw new Error("Output symlinks are forbidden") } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
  await writeFile(destination, await result.outputs[0].text());
  return manifest;
}
export async function packageExtension(directory: string) {
  const root = await realpath(resolve(directory));
  const manifest = validateManifest(JSON.parse(await readFile(join(root, "l8db-extension.json"), "utf8")));
  const files: Record<string, string> = {};
  let size = 0;
  let visited = 0;
  const add = async (path: string) => {
    if (++visited > 512) throw new Error("Too many package entries");
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw new Error("Package symlinks are forbidden");
    const name = relative(root, await realpath(path)).split("\\").join("/");
    if (!safePath(name)) throw new Error(`Unsafe package path: ${name}`);
    if (metadata.isDirectory()) { for (const entry of await readdir(path)) await add(join(path, entry)); return }
    size += metadata.size;
    if (!metadata.isFile() || size > 8 * 1024 * 1024 || Object.keys(files).length >= 256) throw new Error("Package limit exceeded");
    files[name] = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path));
  };
  await add(join(root, manifest.main));
  try { await lstat(join(root, "assets")); await add(join(root, "assets")) } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
  return validateArchive({ format: 1, manifest, files });
}
async function main() {
  const [command, directory = ".", destination] = process.argv.slice(2);
  if (command === "build") {
    const manifest = await buildExtension(directory);
    console.log(`Built ${manifest.id}@${manifest.version}`);
  } else if (command === "validate") {
    const archive = await packageExtension(directory);
    console.log(`Valid: ${archive.manifest.id}@${archive.manifest.version}`);
  } else if (command === "pack") {
    await buildExtension(directory);
    const archive = await packageExtension(directory);
    const output = resolve(destination ?? `${archive.manifest.id}-${archive.manifest.version}.l8db-extension`);
    await writeFile(output, JSON.stringify(archive));
    console.log(output);
  } else if (command === "dev") {
    await buildExtension(directory);
    await packageExtension(directory);
    console.log(`Load development folder in l8db Settings → Community Extensions: ${resolve(directory)}\nRebuild with this command, then click Reload in l8db.`);
  } else {
    throw new Error("Usage: l8db-extension <build|validate|pack|dev> [directory] [output.l8db-extension]");
  }
}
if (import.meta.main) main().catch(error => { console.error(String(error)); process.exitCode = 1 });
